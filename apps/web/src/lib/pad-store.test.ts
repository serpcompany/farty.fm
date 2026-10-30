import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Recording } from './recordings'
import { memoryStorage } from './test-storage'

// The Sound Pad's Pads in the `pedos` database (#277), over a real IndexedDB (fake-indexeddb),
// each page with fresh modules.

/** A page of Farty: fresh modules, over this browser's database. */
async function openPage() {
  vi.resetModules()
  return {
    pads: await import('./pad-store'),
    store: await import('./recording-store')
  }
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('localStorage', memoryStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const wav = (n: number) => new Uint8Array([82, 73, 70, 70, n, n, n]).buffer
const bytes = (buffer: ArrayBuffer | null | undefined) => [...new Uint8Array(buffer ?? [])]

describe('the Pads', () => {
  it('start with none assigned', async () => {
    const { pads } = await openPage()
    expect(await pads.loadPads()).toEqual(new Map())
  })

  it('survive a reload', async () => {
    const first = await openPage()
    await first.pads.savePads(
      new Map([
        [0, 'r3'],
        [4, 'r1'],
        [11, 'r3']
      ])
    )
    const reloaded = await openPage()
    expect(await reloaded.pads.loadPads()).toEqual(
      new Map([
        [0, 'r3'],
        [4, 'r1'],
        [11, 'r3']
      ])
    )
  })

  it('keep only what was saved last', async () => {
    const { pads } = await openPage()
    await pads.savePads(
      new Map([
        [0, 'r1'],
        [1, 'r2']
      ])
    )
    await pads.savePads(new Map([[1, 'r3']]))
    expect(await pads.loadPads()).toEqual(new Map([[1, 'r3']]))
  })

  it('clear with the library', async () => {
    const { pads, store } = await openPage()
    await pads.savePads(new Map([[0, 'r1']]))
    await store.clearLibrary()
    expect(await pads.loadPads()).toEqual(new Map())
  })

  it("clear on a guest's new visit, with the last visit's farts", async () => {
    const { pads, store } = await openPage()
    const kept = await store.saveRecording(
      { seconds: 1, sampleRate: 48_000, waveform: [0.5] },
      wav(1)
    )
    await pads.savePads(new Map([[0, kept.id]]))
    await store.clearVisit(new Set([kept.id]))
    expect(await pads.loadPads()).toEqual(new Map())
    expect((await store.loadRecordings()).map(r => r.id)).toEqual([kept.id])
  })
})

/** Writes a version 4 `pedos` database, as a browser on a build from before #277 left it. */
async function version4(fill: (store: (name: string) => IDBObjectStore) => void) {
  await new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('pedos', 4)
    open.onupgradeneeded = () => {
      const database = open.result
      for (const name of ['recordings', 'toots'])
        database.createObjectStore(name, { keyPath: 'id' })
      database.createObjectStore('outbox', { keyPath: 'key' })
      for (const name of ['audio', 'tootAudio', 'downloads', 'meta'])
        database.createObjectStore(name)
      fill(name => (open.transaction as IDBTransaction).objectStore(name))
    }
    open.onsuccess = () => {
      open.result.close()
      resolve()
    }
    open.onerror = () => reject(open.error)
  })
}

describe('version 5', () => {
  it('adds the Pads and keeps every other store', async () => {
    const recording: Recording = {
      id: crypto.randomUUID(),
      number: 1,
      createdAt: 1,
      seconds: 1,
      sampleRate: 48_000,
      waveform: [0.25],
      analysis: { state: 'notAnalyzed' },
      placedPitch: 48
    }
    const toot = {
      id: crypto.randomUUID(),
      title: 'Mary Had a Little Lamb',
      songId: 'mary-had-a-little-lamb',
      createdAt: 1,
      seconds: 3,
      arrangement: { transposition: 0, recordingForPitch: {} }
    }
    const queued = { key: `recordings:${recording.id}`, kind: 'recordings', id: recording.id }
    await version4(tx => {
      tx('recordings').put(recording)
      tx('audio').put(wav(1), recording.id)
      tx('toots').put(toot)
      tx('tootAudio').put(wav(2), toot.id)
      tx('outbox').put(queued)
      tx('downloads').put({ kind: 'toots', id: 'gone' }, 'toots:gone')
      tx('meta').put(123, 'cursor')
    })

    const { pads, store } = await openPage()
    const database = await store.db()
    expect(database.version).toBe(5)
    expect([...database.objectStoreNames].sort()).toEqual([
      'audio',
      'downloads',
      'meta',
      'outbox',
      'pads',
      'recordings',
      'tootAudio',
      'toots'
    ])
    expect(await store.loadRecordings()).toEqual([recording])
    expect(bytes(await store.loadAudio(recording.id))).toEqual(bytes(wav(1)))
    expect(await database.getAll('toots')).toEqual([toot])
    expect(bytes(await database.get('tootAudio', toot.id))).toEqual(bytes(wav(2)))
    expect(await database.getAll('outbox')).toEqual([queued])
    expect(await database.get('downloads', 'toots:gone')).toEqual({ kind: 'toots', id: 'gone' })
    expect(await database.get('meta', 'cursor')).toBe(123)
    expect(await pads.loadPads()).toEqual(new Map())
  })
})
