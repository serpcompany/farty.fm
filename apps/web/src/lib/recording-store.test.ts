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
