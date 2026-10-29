import { describe, expect, it } from 'vitest'
import {
  anotherBrowsersRecording,
  bytes,
  claimedBy,
  libraryHarness,
  newToot,
  openLibraryPage,
  openOlderLibrary,
  wav
} from '@/test-support/library-page'

const library = libraryHarness()

function version3(fill: (store: (name: string) => IDBObjectStore) => void, keepOpen = false) {
  return openOlderLibrary(
    3,
    (database, transaction) => {
      for (const name of ['recordings', 'toots']) {
        database.createObjectStore(name, { keyPath: 'id' })
      }
      database.createObjectStore('outbox', { keyPath: 'key' })
      for (const name of ['audio', 'tootAudio', 'downloads', 'meta']) {
        database.createObjectStore(name)
      }
      fill(name => transaction.objectStore(name))
    },
    keepOpen
  )
}

describe('version 4, which shuts code from before #268 out of an outbox that may hold a place', () => {
  it('keeps Recordings, Toots, their WAVs, the outbox and what waits to download', async () => {
    const recording = anotherBrowsersRecording(1)
    const made = newToot()
    const queued = {
      key: `toots:${made.id}`,
      kind: 'toots',
      id: made.id,
      op: 'rename',
      sent: false,
      queuedAt: 1,
      version: 'v'
    }
    await version3(store => {
      store('recordings').put(recording)
      store('audio').put(wav(1), recording.id)
      store('toots').put(made)
      store('tootAudio').put(wav(2), made.id)
      store('outbox').put(queued)
      store('downloads').put({ kind: 'recordings', id: 'gone' }, 'recordings:gone')
      store('meta').put(123, 'cursor')
    })
    const database = await library.page.store.db()
    expect(database.version).toBe(4)
    expect(await library.page.store.loadRecordings()).toEqual([recording])
    expect(bytes(await library.page.store.loadAudio(recording.id))).toEqual(bytes(wav(1)))
    expect(await library.page.toots.loadToots()).toEqual([made])
    expect(await database.getAll('outbox')).toEqual([queued])
    expect(await database.count('downloads')).toBe(1)
  })

  it('reads the whole library once: an older tab skipped placements and moved the cursor past them', async () => {
    claimedBy('user-a')
    const recording = anotherBrowsersRecording(1)
    library.account.add('recordings', { ...recording, placedPitch: 48 }, wav(1))
    await version3(store => {
      store('recordings').put(recording)
      store('audio').put(wav(1), recording.id)
      store('meta').put(10 ** 13, 'cursor')
    })
    expect(await (await library.page.store.db()).get('meta', 'cursor')).toBe(0)
    expect(await library.page.sync.leftByAnAccount()).toBe(true)
    await library.page.sync.syncOnce('user-a')
    expect((await library.page.store.loadRecordings())[0].placedPitch).toBe(48)
    const reads = () => library.account.sent.filter(s => s.method === 'GET').map(s => s.path)
    expect(reads()).toEqual(['/api/library/?since=0'])
    library.page = await openLibraryPage()
    await library.page.sync.syncOnce('user-a')
    expect(reads().at(-1)).not.toBe('/api/library/?since=0')
  })

  it("leaves a guest's library without a cursor", async () => {
    await version3(store => store('recordings').put(anotherBrowsersRecording(1)))
    expect(await library.page.sync.leftByAnAccount()).toBe(false)
  })

  it('closes a tab’s version 3 connection, which then can’t open the library again', async () => {
    const recording = anotherBrowsersRecording(1)
    const older = await version3(store => store('recordings').put(recording), true)
    older.onversionchange = () => older.close()
    expect((await library.page.store.db()).version).toBe(4)
    expect(() => older.transaction('outbox')).toThrow()
    const reopened = await new Promise<string>(resolve => {
      const open = indexedDB.open('pedos', 3)
      open.onsuccess = () => resolve('opened')
      open.onerror = () => resolve(open.error?.name ?? '')
    })
    expect(reopened).toBe('VersionError')
    expect(await library.page.store.loadRecordings()).toEqual([recording])
  })
})
