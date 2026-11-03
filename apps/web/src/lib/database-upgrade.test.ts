import { describe, expect, it } from 'vitest'
import type { Recording } from '@/lib/recordings'
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
const { outbox, requests, sendsAlone } = library

type OlderVersion = 3 | 5 | 6 | 7
type Fill = (store: (name: string) => IDBObjectStore) => void

function olderLibrary(version: OlderVersion, fill: Fill, keepOpen = false) {
  return openOlderLibrary(
    version,
    (database, transaction) => {
      for (const name of ['recordings', 'toots']) {
        database.createObjectStore(name, { keyPath: 'id' })
      }
      database.createObjectStore('outbox', { keyPath: 'key' })
      for (const name of ['audio', 'tootAudio', 'downloads', 'meta']) {
        database.createObjectStore(name)
      }
      if (version >= 5) database.createObjectStore('pads')
      if (version >= 7) database.createObjectStore('favorites')
      fill(name => transaction.objectStore(name))
    },
    keepOpen
  )
}

const version3 = (fill: Fill) => olderLibrary(3, fill)
const version5 = (fill: Fill) => olderLibrary(5, fill)

async function olderTab(version: OlderVersion, fill: Fill): Promise<IDBDatabase> {
  const older = await olderLibrary(version, fill, true)
  older.onversionchange = () => older.close()
  return older
}

function recordingOnAPad(recording: Recording): Fill {
  return store => {
    store('recordings').put(recording)
    store('audio').put(wav(1), recording.id)
    store('pads').put(recording.id, 0)
    store('meta').put(10 ** 13, 'cursor')
  }
}

async function upgraded() {
  const database = await library.page.store.db()
  expect(database.version).toBe(library.page.store.DB_VERSION)
  return database
}

function reopenedAt(version: number): Promise<string> {
  return new Promise(resolve => {
    const open = indexedDB.open('pedos', version)
    open.onsuccess = () => resolve('opened')
    open.onerror = () => resolve(open.error?.name ?? '')
  })
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
    const database = await upgraded()
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
    const older = await olderTab(3, store => store('recordings').put(recording))
    await upgraded()
    expect(() => older.transaction('outbox')).toThrow()
    expect(await reopenedAt(3)).toBe('VersionError')
    expect(await library.page.store.loadRecordings()).toEqual([recording])
  })
})

describe('version 6', () => {
  it('reads the whole library once, for the Trims an older tab dropped, and shuts that tab out', async () => {
    claimedBy('user-a')
    const recording = anotherBrowsersRecording(1)
    const trim = {
      startSeconds: 0.25,
      endSeconds: 0.75,
      fart: { startSeconds: 0.25, endSeconds: 0.75 }
    }
    library.account.add('recordings', { ...recording, placedPitch: 48, trim }, wav(1))
    const older = await olderTab(5, recordingOnAPad({ ...recording, placedPitch: 48 }))
    expect(await (await library.page.store.db()).get('meta', 'cursor')).toBe(0)
    expect(await (await library.page.store.db()).get('pads', 0)).toBe(recording.id)
    expect(() => older.transaction('outbox')).toThrow()
    await library.page.sync.syncOnce('user-a')
    expect((await library.page.store.loadRecordings())[0]).toEqual({
      ...recording,
      placedPitch: 48,
      trim
    })
    expect(await reopenedAt(5)).toBe('VersionError')
  })

  it('sends a place queued by version 5 code as the Placed Pitch alone, keeping the Trim', async () => {
    claimedBy('user-a')
    const recording = { ...anotherBrowsersRecording(1), seconds: 3 }
    const trim = {
      startSeconds: 0.8868,
      endSeconds: 2.0821,
      fart: { startSeconds: 0.8868, endSeconds: 2.0821 }
    }
    library.account.add('recordings', { ...recording, placedPitch: 36, trim }, wav(1))
    await version5(tx => {
      tx('recordings').put({ ...recording, placedPitch: 38 })
      tx('audio').put(wav(1), recording.id)
      tx('outbox').put({
        key: `recordings:${recording.id}`,
        kind: 'recordings',
        id: recording.id,
        op: 'place',
        sent: false,
        queuedAt: Date.now(),
        version: crypto.randomUUID()
      })
      tx('meta').put(10 ** 13, 'cursor')
    })
    await sendsAlone(recording.id, { placedPitch: 38 }, { placedPitch: 38, trim })
  })
})

describe('version 7', () => {
  it('adds the Favorite Songs, keeps the rest, reads the whole library once and shuts out older tabs', async () => {
    claimedBy('user-a')
    const recording = anotherBrowsersRecording(1)
    library.account.add('recordings', recording, wav(1))
    library.account.setFavorite('twinkle', true)
    const older = await olderTab(6, recordingOnAPad(recording))
    const database = await upgraded()
    expect([...database.objectStoreNames]).toContain('favorites')
    expect(await database.get('meta', 'cursor')).toBe(0)
    expect(await database.get('pads', 0)).toBe(recording.id)
    expect(() => older.transaction('outbox')).toThrow()
    await library.page.sync.syncOnce('user-a')
    expect(await library.page.favorites.loadFavorites()).toEqual(['twinkle'])
    expect(await library.page.store.loadRecordings()).toEqual([recording])
    expect(await reopenedAt(6)).toBe('VersionError')
  })
})

describe('version 8', () => {
  it('keeps the Favorite Songs and their queue, reads the names once and shuts out older tabs', async () => {
    claimedBy('user-a')
    const recording = anotherBrowsersRecording(1)
    library.account.add('recordings', { ...recording, placedPitch: 45, name: 'Big one' }, wav(1))
    const older = await olderTab(7, tx => {
      tx('recordings').put({ ...recording, placedPitch: 48 })
      tx('audio').put(wav(1), recording.id)
      tx('favorites').put(Date.now(), 'twinkle')
      for (const [kind, id, op, fields] of [
        ['favorites', 'twinkle', 'put', undefined],
        ['recordings', recording.id, 'place', ['placedPitch']]
      ] as const)
        tx('outbox').put({
          key: `${kind}:${id}`,
          kind,
          id,
          op,
          sent: false,
          queuedAt: Date.now(),
          version: crypto.randomUUID(),
          ...(fields ? { fields } : {})
        })
      tx('meta').put(10 ** 13, 'cursor')
    })
    const database = await upgraded()
    expect(await database.get('meta', 'cursor')).toBe(0)
    expect(await library.page.favorites.loadFavorites()).toEqual(['twinkle'])
    expect((await outbox()).map(entry => entry.key).sort()).toEqual(
      [`favorites:twinkle`, `recordings:${recording.id}`].sort()
    )
    expect(() => older.transaction('outbox')).toThrow()
    await library.page.sync.syncOnce('user-a')
    expect(requests('PATCH').map(s => s.json)).toEqual([{ placedPitch: 48 }])
    expect(library.account.favorites()).toEqual(['twinkle'])
    expect(library.account.get('recordings', recording.id)?.item).toMatchObject({
      placedPitch: 48,
      name: 'Big one'
    })
    expect(await outbox()).toEqual([])
    await library.page.sync.syncOnce('user-a')
    expect((await library.page.store.loadRecordings())[0]).toMatchObject({
      placedPitch: 48,
      name: 'Big one'
    })
    expect(await library.page.favorites.loadFavorites()).toEqual(['twinkle'])
    expect(await reopenedAt(7)).toBe('VersionError')
  })
})
