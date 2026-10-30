import 'fake-indexeddb/auto'
import { forceCloseDatabase, IDBFactory } from 'fake-indexeddb'
import { unwrap } from 'idb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// One spy for every page's modules.
const { reportError } = vi.hoisted(() => ({ reportError: vi.fn() }))
vi.mock('./telemetry/errors', () => ({ reportError }))

// A tab left asleep can lose its IndexedDB connection: WebKit drops it ("Connection to Indexed
// Database server lost"), and clearing site data closes it (#222). Over a real IndexedDB
// (fake-indexeddb), each page with fresh modules.
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
    // It takes the connection, though fake-indexeddb's types say its class.
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
    // Closed with no `close` event, as a connection is that the page hasn't heard is lost.
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

  /**
   * The next transaction on the page's connection commits, but the page hears its connection was
   * lost instead, as WebKit can when the IndexedDB server goes away as a transaction completes.
   */
  async function loseNextCompletion(store: Store) {
    const connection = unwrap(await store.db())
    const transaction = connection.transaction.bind(connection)
    connection.transaction = ((...args: Parameters<IDBDatabase['transaction']>) => {
      connection.transaction = transaction
      const tx = transaction(...args)
      // idb listens for `complete`, `error` and `abort` as it wraps the transaction (`tx.done`):
      // its `complete` hears an `error` instead. Whatever listens after it hears as usual.
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
    // Another Toot under its id still fails.
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

describe('placing a Recording by ear (ADR 0015)', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const noiseLike = {
    state: 'analyzed',
    analysis: {
      gestureStartSeconds: 0,
      gestureEndSeconds: 1,
      cutAtReattack: false,
      pitchEstimateMidi: null,
      pitchConfidence: 0,
      recordingPitchMidi: null,
      shortestNoteSeconds: null,
      settleSeconds: null
    }
  } as const

  it('keeps the note through a new analysis, and places nothing that is gone', async () => {
    vi.resetModules()
    const store = await import('./recording-store')
    const saved = await store.saveRecording(
      { seconds: 1, sampleRate: 48_000, waveform: [0.5] },
      new ArrayBuffer(8)
    )
    expect(saved.placedPitch).toBeUndefined()
    expect(await store.placeRecording(saved.id, { placedPitch: 48 })).toEqual({
      ...saved,
      placedPitch: 48
    })
    await store.saveAnalysis(saved.id, noiseLike)
    const [loaded] = await store.loadRecordings()
    expect(loaded).toEqual({ ...saved, analysis: noiseLike, placedPitch: 48 })
    expect((await store.placeRecording(saved.id, { placedPitch: null }))?.placedPitch).toBeNull()
    expect(await store.placeRecording('gone', { placedPitch: 40 })).toBeNull()
    const outbox = await store.withDb(database => database.getAll('outbox'))
    expect(outbox.map(entry => [entry.id, entry.op])).toEqual([[saved.id, 'put']])
  })

  it('keeps a Trim beside the take, through a new analysis and a new note, until it is taken off (ADR 0019)', async () => {
    vi.resetModules()
    const store = await import('./recording-store')
    const audio = new Uint8Array([1, 2, 3, 4]).buffer
    const saved = await store.saveRecording(
      { seconds: 1, sampleRate: 48_000, waveform: [0.5] },
      audio
    )
    const trim = {
      startSeconds: 0.3,
      endSeconds: 0.7,
      fart: { startSeconds: 0.3, endSeconds: 0.7 }
    }
    expect(await store.placeRecording(saved.id, { placedPitch: 48, trim })).toEqual({
      ...saved,
      placedPitch: 48,
      trim
    })
    await store.saveAnalysis(saved.id, noiseLike)
    expect((await store.placeRecording(saved.id, { placedPitch: 50 }))?.trim).toEqual(trim)
    const [loaded] = await store.loadRecordings()
    expect(loaded).toEqual({ ...saved, analysis: noiseLike, placedPitch: 50, trim })
    expect(await store.placeRecording(saved.id, { trim: null })).toEqual({ ...loaded, trim: null })
    // The saved take never changes.
    expect(new Uint8Array(await store.loadAudio(saved.id))).toEqual(new Uint8Array([1, 2, 3, 4]))
  })
})
