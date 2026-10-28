import 'fake-indexeddb/auto'
import { forceCloseDatabase, IDBFactory } from 'fake-indexeddb'
import { unwrap } from 'idb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { reportError } = vi.hoisted(() => ({ reportError: vi.fn() }))
vi.mock('./telemetry/errors', () => ({ reportError }))

describe('a lost database connection', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    reportError.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function page() {
    vi.resetModules()
    return await import('./recording-store')
  }

  type Store = Awaited<ReturnType<typeof page>>

  const save = (store: Store) =>
    store.saveRecording({ seconds: 1, sampleRate: 48_000, waveform: [0.5] }, new ArrayBuffer(8))

  const lost = () =>
    new DOMException(
      'Connection to Indexed Database server lost. Refresh the page to try again',
      'UnknownError'
    )

  it('opens a fresh connection once the browser closes it', async () => {
    const store = await page()
    await save(store)
    const first = await store.db()
    forceCloseDatabase(unwrap(first) as unknown as Parameters<typeof forceCloseDatabase>[0])
    const saved = await save(store)
    expect(saved.number).toBe(2)
    expect(await store.db()).not.toBe(first)
    expect(await store.loadRecordings()).toHaveLength(2)
    expect(reportError).not.toHaveBeenCalled()
  })

  it('saves on a fresh connection when the one it had was closed without a word', async () => {
    const store = await page()
    await save(store)
    ;(await store.db()).close()
    const saved = await save(store)
    expect(saved.number).toBe(2)
    expect((await store.loadAudio(saved.id)).byteLength).toBe(8)
    expect(reportError).not.toHaveBeenCalled()
  })

  it('tries once more on a fresh connection, and reports when that fails too', async () => {
    const store = await page()
    const work = vi.fn(async (_database: unknown) => {
      throw lost()
    })
    await expect(store.withDb(work)).rejects.toThrow('server lost')
    expect(work).toHaveBeenCalledTimes(2)
    expect(work.mock.calls[0][0]).not.toBe(work.mock.calls[1][0])
    expect(reportError).toHaveBeenCalledOnce()
    expect(reportError).toHaveBeenCalledWith('library-connection-lost', expect.any(DOMException))
  })

  it('leaves any other failure to the caller', async () => {
    const store = await page()
    const work = vi.fn(async () => {
      throw new DOMException('Key already exists in the object store.', 'ConstraintError')
    })
    await expect(store.withDb(work)).rejects.toThrow('already exists')
    expect(work).toHaveBeenCalledOnce()
    expect(reportError).not.toHaveBeenCalled()
  })

  it('reports only a lost connection: another failure on the retry is thrown as it is', async () => {
    const store = await page()
    const constraint = new DOMException(
      'Key already exists in the object store.',
      'ConstraintError'
    )
    const work = vi
      .fn<(database: unknown, retry: boolean) => Promise<void>>()
      .mockRejectedValueOnce(lost())
      .mockRejectedValueOnce(constraint)
    await expect(store.withDb(work)).rejects.toBe(constraint)
    expect(work).toHaveBeenCalledTimes(2)
    expect(work.mock.calls.map(([, retry]) => retry)).toEqual([false, true])
    expect(reportError).not.toHaveBeenCalled()
  })

  async function loseNextCompletion(store: Store) {
    const connection = unwrap(await store.db())
    const transaction = connection.transaction.bind(connection)
    connection.transaction = ((...args: Parameters<IDBDatabase['transaction']>) => {
      connection.transaction = transaction
      const tx = transaction(...args)
      let failed: EventListenerOrEventListenerObject | null = null
      const listen = tx.addEventListener
      tx.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject) => {
        if (type === 'complete') {
          listen.call(tx, 'complete', event => {
            Object.defineProperty(tx, 'error', { get: lost })
            if (typeof failed === 'function') failed(event)
          })
          return
        }
        if (type === 'error') failed = listener
        if (type === 'abort') tx.addEventListener = listen
        listen.call(tx, type, listener)
      }) as IDBTransaction['addEventListener']
      return tx
    }) as IDBDatabase['transaction']
  }

  it('a retried save finds the Recording its first try saved, unheard, and keeps one', async () => {
    const store = await page()
    await loseNextCompletion(store)
    const saved = await save(store)
    expect(saved.number).toBe(1)
    const all = await store.loadRecordings()
    expect(all).toEqual([saved])
    const outbox = await store.withDb(database => database.getAll('outbox'))
    expect(outbox.map(entry => entry.id)).toEqual([saved.id])
    expect(reportError).not.toHaveBeenCalled()
  })

  it('a retried Toot save finds the Toot its first try saved, unheard, and keeps one', async () => {
    const store = await page()
    const toots = await import('./toot-store')
    const toot = {
      id: 'toot-1',
      title: 'Mary Had a Little Lamb',
      songId: 'mary',
      createdAt: 1,
      seconds: 12,
      arrangement: { transposition: 0, recordingForPitch: { 55: 'recording-1' } }
    }
    await loseNextCompletion(store)
    await toots.saveToot(toot, new ArrayBuffer(8))
    expect(await toots.loadToots()).toEqual([toot])
    const outbox = await store.withDb(database => database.getAll('outbox'))
    expect(outbox.map(entry => entry.id)).toEqual([toot.id])
    await expect(toots.saveToot({ ...toot, title: 'Other' }, new ArrayBuffer(8))).rejects.toThrow()
    expect(reportError).not.toHaveBeenCalled()
  })

  it.each([
    [new DOMException('The database connection is closing.', 'InvalidStateError'), true],
    [lost(), true],
    [new DOMException('The connection was closed.', 'AbortError'), true],
    [new DOMException('The transaction was aborted.', 'AbortError'), false],
    [new DOMException('Key already exists.', 'ConstraintError'), false],
    [new TypeError('nope'), false],
    ['InvalidStateError', false]
  ])('knows a lost connection by its error (%s)', async (error, expected) => {
    const store = await page()
    expect(store.connectionLost(error)).toBe(expected)
  })
})
