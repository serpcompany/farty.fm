import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryChange } from './library-sync'
import type { OutboxOp } from './outbox'
import type { Recording } from './recordings'
import { type FakeAccount, fakeAccount } from './test-library'
import { blockedStorage, memoryStorage } from './test-storage'
import type { Toot } from './toot'

// The outbox, the claim and the sync, over a real IndexedDB (fake-indexeddb) and a fake account
// (`test-library.ts`).

let account: FakeAccount
let page: Awaited<ReturnType<typeof openPage>>

/** A page of Farty: fresh modules, over this browser's database. */
async function openPage() {
  vi.resetModules()
  return {
    sync: await import('./library-sync'),
    store: await import('./recording-store'),
    toots: await import('./toot-store')
  }
}

beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('localStorage', memoryStorage())
  // No Web Locks: this tab is the only one.
  vi.stubGlobal('navigator', {})
  account = fakeAccount('user-a')
  vi.stubGlobal('fetch', vi.fn(account.fetch))
  page = await openPage()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const wav = (n: number) => new Uint8Array([82, 73, 70, 70, n, n, n]).buffer
const bytes = (buffer: ArrayBuffer | null | undefined) => [...new Uint8Array(buffer ?? [])]
const fields = { seconds: 1, sampleRate: 48_000, waveform: [0.5] }

/** A Recording saved here, analyzed unless `analyzed` is false. */
async function recorded(n = 1, analyzed = true): Promise<Recording> {
  const recording = await page.store.saveRecording(fields, wav(n))
  if (!analyzed) return recording
  return (await page.store.saveAnalysis(recording.id, { state: 'notAnalyzed' })) as Recording
}

function toot(title = 'Mary Had a Little Lamb'): Toot {
  return {
    id: crypto.randomUUID(),
    title,
    songId: 'mary-had-a-little-lamb',
    createdAt: Date.now(),
    seconds: 3,
    arrangement: { transposition: 0, recordingForPitch: {} }
  }
}

/** A Recording another browser uploaded. */
function theirs(n = 2): Recording {
  return {
    id: crypto.randomUUID(),
    number: n,
    createdAt: Date.now(),
    seconds: 1,
    sampleRate: 48_000,
    waveform: [0.25],
    analysis: { state: 'notAnalyzed' }
  }
}

const claimedBy = (id: string) => localStorage.setItem('pedos.account', id)
const outbox = async () => (await page.store.db()).getAll('outbox')
const requests = (method: string) => account.sent.filter(s => s.method === method)
const refuse = (method: string, status: number, error: string) => {
  account.intercept = sent =>
    sent.method === method ? Response.json({ error }, { status }) : undefined
}

describe('the outbox', () => {
  it('queues each save, rename and delete with the change itself', async () => {
    const recording = await recorded()
    const saved = toot()
    await page.toots.saveToot(saved, wav(9))
    expect((await outbox()).map(e => [e.kind, e.op])).toEqual(
      expect.arrayContaining([
        ['recordings', 'put'],
        ['toots', 'put']
      ])
    )
    // Not uploaded yet: the rename goes in the upload, and the delete leaves nothing to send.
    await page.toots.renameToot(saved.id, 'Renamed')
    await page.store.deleteRecording(recording.id)
    expect(await outbox()).toEqual([expect.objectContaining({ id: saved.id, op: 'put' })])
  })

  it('queues every Recording and Toot a browser kept before version 3, oldest first', async () => {
    const recording = { ...theirs(1), createdAt: 2_000 }
    const older = { ...toot(), createdAt: 1_000 }
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('pedos', 2)
      open.onupgradeneeded = () => {
        const database = open.result
        database.createObjectStore('recordings', { keyPath: 'id' }).put(recording)
        database.createObjectStore('audio').put(wav(1), recording.id)
        database.createObjectStore('toots', { keyPath: 'id' }).put(older)
        database.createObjectStore('tootAudio').put(wav(2), older.id)
      }
      open.onsuccess = () => {
        open.result.close()
        resolve()
      }
      open.onerror = () => reject(open.error)
    })
    const queued = (await outbox()).sort((a, b) => a.queuedAt - b.queuedAt)
    expect(queued.map(e => [e.id, e.op])).toEqual([
      [older.id, 'put'],
      [recording.id, 'put']
    ])
    expect(await page.store.loadRecordings()).toEqual([recording])
  })

  // As a full disk does: the request just before the outbox's aborts the transaction. Each write
  // fails, and leaves nothing unhandled (toots.spec.ts does the rename in Chromium).
  it('fails a write the store refuses with its queue, and leaves nothing unhandled', async () => {
    const unhandled: unknown[] = []
    const report = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', report)
    type Method = (this: IDBObjectStore, ...args: unknown[]) => IDBRequest
    const prototype = IDBObjectStore.prototype as unknown as Record<string, Method>
    const refuse = (method: 'add' | 'put' | 'delete', store: string) => {
      const original = prototype[method]
      prototype[method] = function (...args) {
        const request = original.apply(this, args)
        if (this.name === store) this.transaction.abort()
        return request
      }
      return () => {
        prototype[method] = original
      }
    }
    try {
      const recording = await recorded()
      const kept = toot()
      await page.toots.saveToot(kept, wav(9))
      const writes = [
        ['put', 'toots', () => page.toots.renameToot(kept.id, 'Not kept')],
        ['add', 'tootAudio', () => page.toots.saveToot(toot(), wav(8))],
        ['add', 'audio', () => page.store.saveRecording(fields, wav(7))],
        ['delete', 'downloads', () => page.store.deleteRecording(recording.id)]
      ] as const
      for (const [method, store, write] of writes) {
        const mend = refuse(method, store)
        await expect(write()).rejects.toThrow()
        mend()
      }
      await new Promise(resolve => setTimeout(resolve, 50))
    } finally {
      process.off('unhandledRejection', report)
    }
    expect(unhandled).toEqual([])
    expect((await page.toots.loadToots()).map(t => t.title)).toEqual(['Mary Had a Little Lamb'])
    expect(await page.store.loadRecordings()).toHaveLength(1)
  })

  it('clears with the library, with what waits to download and the last read', async () => {
    account.add('recordings', theirs(), wav(5))
    claimedBy('user-a')
    await recorded()
    await page.sync.syncOnce('user-a')
    await recorded(2, false)
    await page.store.clearLibrary()
    const database = await page.store.db()
    for (const name of ['recordings', 'outbox', 'downloads', 'meta'] as const) {
      expect(await database.count(name)).toBe(0)
    }
  })
})

type Fill = (store: (name: string) => IDBObjectStore) => void

/** Writes a version 3 `pedos` database, as a browser on a build from before #268 left it. */
const version3 = (fill: Fill, keepOpen = false) => olderDatabase(3, fill, keepOpen)
/** Writes a version 5 `pedos` database, as a browser on a build from before #293 left it. */
const version5 = (fill: Fill, keepOpen = false) => olderDatabase(5, fill, keepOpen)

async function olderDatabase(version: 3 | 5, fill: Fill, keepOpen: boolean) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open('pedos', version)
    open.onupgradeneeded = () => {
      const database = open.result
      for (const name of ['recordings', 'toots'])
        database.createObjectStore(name, { keyPath: 'id' })
      database.createObjectStore('outbox', { keyPath: 'key' })
      for (const name of ['audio', 'tootAudio', 'downloads', 'meta'])
        database.createObjectStore(name)
      if (version === 5) database.createObjectStore('pads')
      fill(name => (open.transaction as IDBTransaction).objectStore(name))
    }
    open.onsuccess = () => {
      if (!keepOpen) open.result.close()
      resolve(open.result)
    }
    open.onerror = () => reject(open.error)
  })
}

// Version 4 (#268) changes no store: it shuts out code from before #268, which sends an outbox
// op it doesn't know, such as `place`, as a delete.
describe('version 4', () => {
  it('keeps Recordings, Toots, their WAVs, the outbox and what waits to download', async () => {
    const recording = theirs(1)
    const made = toot()
    const queued = {
      key: `toots:${made.id}`,
      kind: 'toots',
      id: made.id,
      op: 'rename',
      sent: false,
      queuedAt: 1,
      version: 'v'
    }
    await version3(tx => {
      tx('recordings').put(recording)
      tx('audio').put(wav(1), recording.id)
      tx('toots').put(made)
      tx('tootAudio').put(wav(2), made.id)
      tx('outbox').put(queued)
      tx('downloads').put({ kind: 'recordings', id: 'gone' }, 'recordings:gone')
      tx('meta').put(123, 'cursor')
    })
    const database = await page.store.db()
    expect(database.version).toBe(page.store.DB_VERSION)
    expect(await page.store.loadRecordings()).toEqual([recording])
    expect(bytes(await page.store.loadAudio(recording.id))).toEqual(bytes(wav(1)))
    expect(await page.toots.loadToots()).toEqual([made])
    expect(await database.getAll('outbox')).toEqual([queued])
    expect(await database.count('downloads')).toBe(1)
  })

  it('reads the whole library once: an older tab skipped placements and moved the cursor past them', async () => {
    claimedBy('user-a')
    const recording = theirs(1)
    account.add('recordings', { ...recording, placedPitch: 48 }, wav(1))
    await version3(tx => {
      tx('recordings').put(recording)
      tx('audio').put(wav(1), recording.id)
      // Past everything the account has: an older tab read the Placed Pitch and dropped it.
      tx('meta').put(10 ** 13, 'cursor')
    })
    expect(await (await page.store.db()).get('meta', 'cursor')).toBe(0)
    expect(await page.sync.leftByAnAccount()).toBe(true)
    await page.sync.syncOnce('user-a')
    expect((await page.store.loadRecordings())[0].placedPitch).toBe(48)
    expect(account.sent.filter(s => s.method === 'GET').map(s => s.path)).toEqual([
      '/api/library/?since=0'
    ])
    // Once: the next open reads since the new cursor.
    page = await openPage()
    await page.sync.syncOnce('user-a')
    expect(account.sent.filter(s => s.method === 'GET').at(-1)?.path).not.toBe(
      '/api/library/?since=0'
    )
  })

  it("leaves a guest's library without a cursor", async () => {
    await version3(store => store('recordings').put(theirs(1)))
    expect(await page.sync.leftByAnAccount()).toBe(false)
  })

  it('closes a tab’s version 3 connection, which then can’t open the library again', async () => {
    const recording = theirs(1)
    const older = await version3(store => store('recordings').put(recording), true)
    // What an older build's `blocking` does.
    older.onversionchange = () => older.close()
    expect((await page.store.db()).version).toBe(page.store.DB_VERSION)
    expect(() => older.transaction('outbox')).toThrow()
    const reopened = await new Promise<string>(resolve => {
      const open = indexedDB.open('pedos', 3)
      open.onsuccess = () => resolve('opened')
      open.onerror = () => resolve(open.error?.name ?? '')
    })
    expect(reopened).toBe('VersionError')
    expect(await page.store.loadRecordings()).toEqual([recording])
  })
})

// Version 6 (#293) changes no store either: it shuts out code from before Trims, which would send
// a `place` without the Trim and settle it, and drop the account's Trims while its cursor moved on.
describe('version 6', () => {
  it('reads the whole library once, for the Trims an older tab dropped, and shuts that tab out', async () => {
    claimedBy('user-a')
    const recording = theirs(1)
    const trim = { startSeconds: 0.25, endSeconds: 0.75 }
    account.add('recordings', { ...recording, placedPitch: 48, trim }, wav(1))
    const older = await version5(tx => {
      tx('recordings').put({ ...recording, placedPitch: 48 })
      tx('audio').put(wav(1), recording.id)
      tx('pads').put(recording.id, 0)
      tx('meta').put(10 ** 13, 'cursor')
    }, true)
    older.onversionchange = () => older.close()
    expect(await (await page.store.db()).get('meta', 'cursor')).toBe(0)
    expect(await (await page.store.db()).get('pads', 0)).toBe(recording.id)
    expect(() => older.transaction('outbox')).toThrow()
    await page.sync.syncOnce('user-a')
    expect((await page.store.loadRecordings())[0]).toEqual({ ...recording, placedPitch: 48, trim })
    const reopened = await new Promise<string>(resolve => {
      const open = indexedDB.open('pedos', 5)
      open.onsuccess = () => resolve('opened')
      open.onerror = () => resolve(open.error?.name ?? '')
    })
    expect(reopened).toBe('VersionError')
  })
})

describe('claimLibrary', () => {
  it("makes a guest's library the account's, keeping it", async () => {
    await recorded()
    expect(await page.sync.claimLibrary('user-a')).toBe(true)
    expect(localStorage.getItem('pedos.account')).toBe('user-a')
    expect(await page.store.loadRecordings()).toHaveLength(1)
  })

  it("clears another account's library first, so it never uploads to this one", async () => {
    claimedBy('user-b')
    await recorded()
    const changes: LibraryChange[] = []
    page.sync.onLibraryChanged(change => changes.push(change))
    expect(await page.sync.claimLibrary('user-a')).toBe(true)
    expect(await page.store.loadRecordings()).toEqual([])
    expect(await outbox()).toEqual([])
    expect(changes).toContainEqual({ reset: true })
    expect(localStorage.getItem('pedos.account')).toBe('user-a')
  })

  // Before #156 the marker was `1`: a signed-in browser's, on Staging, whose id wasn't kept.
  it('keeps a library claimed before ids were kept', async () => {
    claimedBy('1')
    await recorded()
    expect(await page.sync.claimLibrary('user-a')).toBe(true)
    expect(await page.store.loadRecordings()).toHaveLength(1)
  })

  it("remembers the account's email, and forgets another account's", async () => {
    expect(await page.sync.claimLibrary('user-a', ' A@Example.com ')).toBe(true)
    expect(localStorage.getItem('pedos.account.email')).toBe('a@example.com')
    expect(await page.sync.claimLibrary('user-a')).toBe(true)
    expect(localStorage.getItem('pedos.account.email')).toBe('a@example.com')
    expect(await page.sync.claimLibrary('user-b')).toBe(true)
    expect(localStorage.getItem('pedos.account.email')).toBeNull()
  })

  it("claims nothing without an id, or where it can't remember whose it is", async () => {
    expect(await page.sync.claimLibrary('')).toBe(false)
    vi.stubGlobal('localStorage', blockedStorage())
    expect(await page.sync.claimLibrary('user-a')).toBe(false)
  })
})

describe('uploading', () => {
  beforeEach(() => claimedBy('user-a'))

  it("uploads Recordings and Toots as they are, naming the library's account", async () => {
    const recording = await recorded(1)
    const saved = toot()
    await page.toots.saveToot(saved, wav(9))
    expect(await page.sync.uploadBeforeSignOut('user-a')).toBe(0)
    expect(bytes(account.get('recordings', recording.id)?.wav)).toEqual(bytes(wav(1)))
    expect(bytes(account.get('toots', saved.id)?.wav)).toEqual(bytes(wav(9)))
    expect(account.get('toots', saved.id)?.item).toMatchObject({ title: saved.title })
    expect(requests('PUT').map(s => s.library)).toEqual(['user-a', 'user-a'])
  })

  it("never uploads a library that's another account's", async () => {
    claimedBy('user-b')
    await recorded()
    expect(await page.sync.uploadBeforeSignOut('user-a')).toBe(1)
    await page.sync.syncOnce('user-a')
    expect(account.sent).toEqual([])
  })

  // A sign-in in another tab claims the library for its account while this one uploads.
  it('stops uploading once the library is claimed by another account', async () => {
    await recorded(1)
    await recorded(2)
    account.intercept = sent => {
      if (sent.method === 'PUT') claimedBy('user-b')
      return undefined
    }
    await page.sync.uploadBeforeSignOut('user-a')
    expect(requests('PUT')).toHaveLength(1)
  })

  it("waits for a Recording's analysis", async () => {
    const recording = await recorded(1, false)
    expect(await page.sync.uploadBeforeSignOut('user-a')).toBe(1)
    expect(requests('PUT')).toEqual([])
    await page.store.saveAnalysis(recording.id, { state: 'notAnalyzed' })
    expect(await page.sync.uploadBeforeSignOut('user-a')).toBe(0)
  })

  it.each([
    [
      'is unreachable',
      () => {
        account.intercept = sent => {
          if (sent.method === 'PUT') throw new TypeError('Failed to fetch')
          return undefined
        }
      }
    ],
    ['answers 401', () => refuse('PUT', 401, 'unauthorized')],
    ['answers 503', () => refuse('PUT', 503, 'unavailable')],
    ['names another account', () => refuse('PUT', 409, 'wrong_account')]
  ])('stops, keeping everything queued, when Farty %s', async (_, fail) => {
    await recorded(1)
    await recorded(2)
    fail()
    expect(await page.sync.uploadBeforeSignOut('user-a')).toBe(2)
    expect(requests('PUT')).toHaveLength(1)
  })

  // A Recording uploads numbered after the account's, which only a read tells.
  it.each([
    ['is offline', () => (account.offline = true)],
    ['names another account', () => refuse('GET', 409, 'wrong_account')]
  ])('uploads nothing until it has read the account: not when Farty %s', async (_, fail) => {
    await recorded(1)
    fail()
    expect(await page.sync.uploadBeforeSignOut('user-a')).toBe(1)
    await page.sync.syncOnce('user-a')
    expect(requests('PUT')).toEqual([])
    expect(account.sent.map(s => s.library)).toEqual(account.sent.map(() => 'user-a'))
  })

  it('names the library’s account in every request', async () => {
    const recording = await recorded(1)
    const saved = toot()
    await page.toots.saveToot(saved, wav(9))
    await page.sync.syncOnce('user-a')
    await page.toots.renameToot(saved.id, 'Renamed')
    await page.store.deleteRecording(recording.id)
    const made = toot()
    account.add('toots', made, wav(6))
    await page.sync.syncOnce('user-a')
    await page.toots.loadTootAudio(made.id)
    expect(new Set(account.sent.map(s => s.method))).toEqual(
      new Set(['GET', 'PUT', 'PATCH', 'DELETE'])
    )
    expect(account.sent.some(s => s.path.endsWith('/audio/'))).toBe(true)
    expect(account.sent.map(s => s.library)).toEqual(account.sent.map(() => 'user-a'))
  })

  it.each([
    ['rename', 'PATCH'],
    ['delete', 'DELETE']
  ])('stops, keeping it queued, when a %s names another account', async (_, method) => {
    const saved = toot()
    await page.toots.saveToot(saved, wav(9))
    await page.sync.syncOnce('user-a')
    if (method === 'PATCH') await page.toots.renameToot(saved.id, 'Renamed')
    else await page.toots.deleteToot(saved.id)
    refuse(method, 409, 'wrong_account')
    expect(await page.sync.uploadBeforeSignOut('user-a')).toBe(1)
    expect(await outbox()).toEqual([expect.objectContaining({ id: saved.id })])
  })

  it('keeps a refused upload queued, and sends the rest', async () => {
    const first = await recorded(1)
    const second = await recorded(2)
    account.intercept = sent =>
      sent.path.includes(first.id)
        ? Response.json({ error: 'limit_reached' }, { status: 409 })
        : undefined
    expect(await page.sync.uploadBeforeSignOut('user-a')).toBe(1)
    expect(account.get('recordings', second.id)).toBeDefined()
    expect(await outbox()).toEqual([expect.objectContaining({ id: first.id, op: 'put' })])
  })

  it('deletes here what the account deleted', async () => {
    const recording = await recorded()
    account.add('recordings', recording, wav(1))
    account.remove('recordings', recording.id)
    expect(await page.sync.uploadBeforeSignOut('user-a')).toBe(0)
    expect(await page.store.loadRecordings()).toEqual([])
  })

  it('renames a Toot on the account that was renamed while it uploaded', async () => {
    const saved = toot('Old')
    await page.toots.saveToot(saved, wav(9))
    account.intercept = async sent => {
      if (sent.method === 'PUT') await page.toots.renameToot(saved.id, 'New')
      return undefined
    }
    expect(await page.sync.uploadBeforeSignOut('user-a')).toBe(0)
    expect(account.get('toots', saved.id)?.item).toMatchObject({ title: 'New' })
  })

  // The account had it from an upload that was cut off, maybe with an older title.
  it('sends the title of a Toot the account already had', async () => {
    const saved = toot('New')
    account.add('toots', { ...saved, title: 'Old' }, wav(9))
    await page.toots.saveToot(saved, wav(9))
    expect(await page.sync.uploadBeforeSignOut('user-a')).toBe(0)
    expect(account.get('toots', saved.id)?.item).toMatchObject({ title: 'New' })
  })

  it('places a Recording on the account, in its upload or after it (ADR 0015)', async () => {
    const early = await recorded(1)
    await page.store.placeRecording(early.id, { placedPitch: 40 })
    // Not uploaded yet: the Placed Pitch goes in the upload.
    expect(await outbox()).toEqual([expect.objectContaining({ id: early.id, op: 'put' })])
    expect(await page.sync.uploadBeforeSignOut('user-a')).toBe(0)
    expect(account.get('recordings', early.id)?.item).toMatchObject({ placedPitch: 40 })
    expect(requests('PATCH')).toEqual([])
    // Uploaded: moved, then taken off, it's sent once, as it is when sent.
    await page.store.placeRecording(early.id, { placedPitch: 41 })
    await page.store.placeRecording(early.id, { placedPitch: null })
    expect((await outbox()).map(e => e.op)).toEqual(['place'])
    expect(await page.sync.uploadBeforeSignOut('user-a')).toBe(0)
    expect(account.get('recordings', early.id)?.item).toMatchObject({ placedPitch: null })
    expect(requests('PATCH').map(s => [s.path, s.library])).toEqual([
      [`/api/recordings/${early.id}/`, 'user-a']
    ])
  })

  it('trims a Recording on the account, in its upload or after it, keeping the take (ADR 0019)', async () => {
    const early = await recorded(1)
    const trim = { startSeconds: 0.25, endSeconds: 0.75 }
    await page.store.placeRecording(early.id, { placedPitch: 40, trim })
    expect(await page.sync.uploadBeforeSignOut('user-a')).toBe(0)
    expect(account.get('recordings', early.id)?.item).toMatchObject({ placedPitch: 40, trim })
    expect(requests('PATCH')).toEqual([])
    // Uploaded: the Trim taken off is sent with the Placed Pitch as they are, and the WAV stays.
    await page.store.placeRecording(early.id, { trim: null })
    expect((await outbox()).map(e => e.op)).toEqual(['place'])
    expect(await page.sync.uploadBeforeSignOut('user-a')).toBe(0)
    expect(account.get('recordings', early.id)?.item).toMatchObject({ placedPitch: 40, trim: null })
    expect(bytes(account.get('recordings', early.id)?.wav)).toEqual(bytes(wav(1)))
    expect(requests('PATCH')).toHaveLength(1)
  })

  it('trims a Recording on the account that was trimmed while it uploaded', async () => {
    const recording = await recorded(1)
    const trim = { startSeconds: 0.1, endSeconds: 0.4 }
    account.intercept = async sent => {
      if (sent.method === 'PUT') await page.store.placeRecording(recording.id, { trim })
      return undefined
    }
    expect(await page.sync.uploadBeforeSignOut('user-a')).toBe(0)
    expect(account.get('recordings', recording.id)?.item).toMatchObject({ trim })
    expect(await outbox()).toEqual([])
  })

  it('places a Recording on the account that was placed while it uploaded', async () => {
    const recording = await recorded(1)
    account.intercept = async sent => {
      if (sent.method === 'PUT') await page.store.placeRecording(recording.id, { placedPitch: 52 })
      return undefined
    }
    expect(await page.sync.uploadBeforeSignOut('user-a')).toBe(0)
    expect(account.get('recordings', recording.id)?.item).toMatchObject({ placedPitch: 52 })
    expect(await outbox()).toEqual([])
  })

  // The account had it from an upload that was cut off, maybe before it was placed.
  it('sends the Placed Pitch of a Recording the account already had', async () => {
    const recording = await recorded(1)
    await page.store.placeRecording(recording.id, { placedPitch: 45 })
    account.add('recordings', { ...recording, placedPitch: null }, wav(1))
    expect(await page.sync.uploadBeforeSignOut('user-a')).toBe(0)
    expect(account.get('recordings', recording.id)?.item).toMatchObject({ placedPitch: 45 })
  })

  it('forgets a place the account refuses, and deletes here what it deleted', async () => {
    const refused = await recorded(1)
    const gone = await recorded(2)
    await page.sync.uploadBeforeSignOut('user-a')
    await page.store.placeRecording(refused.id, { placedPitch: 40 })
    await page.store.placeRecording(gone.id, { placedPitch: 40 })
    account.remove('recordings', gone.id)
    account.intercept = sent =>
      sent.method === 'PATCH' && sent.path.includes(refused.id)
        ? Response.json({ error: 'invalid_request' }, { status: 400 })
        : undefined
    expect(await page.sync.uploadBeforeSignOut('user-a')).toBe(0)
    expect(await outbox()).toEqual([])
    expect((await page.store.loadRecordings()).map(r => r.id)).toEqual([refused.id])
  })

  // A later build's op, as `place` was to code from before #268, which sent it as a delete.
  it('never sends an op it doesn’t know, and keeps it queued', async () => {
    const recording = await recorded(1)
    await page.sync.uploadBeforeSignOut('user-a')
    await page.store.placeRecording(recording.id, { placedPitch: 40 })
    const database = await page.store.db()
    const [entry] = await database.getAll('outbox')
    await database.put('outbox', { ...entry, op: 'later' as OutboxOp })
    const toSend = await recorded(2)
    const before = account.sent.length
    expect(await page.sync.uploadBeforeSignOut('user-a')).toBe(1)
    expect(account.sent.slice(before).filter(s => s.path.includes(recording.id))).toEqual([])
    expect(account.isDeleted('recordings', recording.id)).toBe(false)
    expect(account.get('recordings', toSend.id)).toBeDefined()
    expect(await outbox()).toEqual([expect.objectContaining({ id: recording.id, op: 'later' })])
    expect((await page.store.loadRecordings()).map(r => r.id)).toContain(recording.id)
  })

  it('sends the delete of what reached the account, and nothing for what never did', async () => {
    const uploaded = await recorded(1)
    await page.sync.uploadBeforeSignOut('user-a')
    const local = await recorded(2, false)
    await page.store.deleteRecording(uploaded.id)
    await page.store.deleteRecording(local.id)
    expect(await page.sync.uploadBeforeSignOut('user-a')).toBe(0)
    expect(account.isDeleted('recordings', uploaded.id)).toBe(true)
    expect(account.sent.filter(s => s.path.includes(local.id))).toEqual([])
  })
})

describe('reading the account', () => {
  beforeEach(() => claimedBy('user-a'))

  it("brings another browser's Recordings and Toots, and their WAVs as they were uploaded", async () => {
    const recording = theirs()
    const made = toot()
    account.add('recordings', recording, wav(5))
    account.add('toots', made, wav(6))
    const changes: LibraryChange[] = []
    page.sync.onLibraryChanged(change => changes.push(change))
    await page.sync.syncOnce('user-a')
    expect(await page.store.loadRecordings()).toEqual([recording])
    expect(await page.toots.loadToots()).toEqual([made])
    expect(changes).toEqual([
      { recordings: [recording], toots: [made], deleted: { recordings: [], toots: [] } }
    ])
    // Downloaded when first played.
    expect(bytes(await page.store.loadAudio(recording.id))).toEqual(bytes(wav(5)))
    expect(bytes(await page.toots.loadTootAudio(made.id))).toEqual(bytes(wav(6)))
    expect(await (await page.store.db()).count('downloads')).toBe(0)
  })

  it('deletes what another browser deleted, reading only what changed since', async () => {
    const recording = theirs()
    account.add('recordings', recording, wav(5))
    await page.sync.syncOnce('user-a')
    account.remove('recordings', recording.id)
    const changes: LibraryChange[] = []
    page.sync.onLibraryChanged(change => changes.push(change))
    await page.sync.syncOnce('user-a')
    expect(await page.store.loadRecordings()).toEqual([])
    expect(changes).toEqual([
      { recordings: [], toots: [], deleted: { recordings: [recording.id], toots: [] } }
    ])
    const reads = requests('GET').filter(s => s.path.startsWith('/api/library/'))
    expect(reads.map(s => s.path)).toEqual([
      '/api/library/?since=0',
      expect.not.stringMatching(/since=0$/)
    ])
  })

  it("keeps what this browser is deleting deleted, and a title it's sending", async () => {
    const recording = theirs()
    const made = toot('A')
    const doomed = toot('D')
    account.add('recordings', recording, wav(5))
    account.add('toots', made, wav(6))
    account.add('toots', doomed, wav(7))
    await page.sync.syncOnce('user-a')
    // No change reaches the account yet, and another browser changes each item meanwhile.
    refuse('DELETE', 503, 'unavailable')
    await page.store.deleteRecording(recording.id)
    await page.toots.deleteToot(doomed.id)
    await page.toots.renameToot(made.id, 'C')
    account.rename(made.id, 'B')
    account.rename(doomed.id, 'E')
    account.add('recordings', { ...recording }, wav(5))
    await page.sync.syncOnce('user-a')
    expect(await page.store.loadRecordings()).toEqual([])
    expect((await page.toots.loadToots()).map(t => t.title)).toEqual(['C'])
  })

  it("applies another browser's rename of a Toot this browser isn't changing", async () => {
    const made = toot('A')
    account.add('toots', made, wav(6))
    await page.sync.syncOnce('user-a')
    account.rename(made.id, 'B')
    await page.sync.syncOnce('user-a')
    expect((await page.toots.loadToots())[0].title).toBe('B')
  })

  it("applies another browser's Placed Pitch, keeping this browser's analysis (ADR 0015)", async () => {
    const recording = theirs()
    account.add('recordings', recording, wav(5))
    await page.sync.syncOnce('user-a')
    // This browser's own analysis, as each browser re-analyzes.
    const analysis = { state: 'analyzing' } as const
    await page.store.saveAnalysis(recording.id, analysis)
    account.place(recording.id, 48)
    const changes: LibraryChange[] = []
    page.sync.onLibraryChanged(change => changes.push(change))
    await page.sync.syncOnce('user-a')
    const placed = { ...recording, analysis, placedPitch: 48 }
    expect(await page.store.loadRecordings()).toEqual([placed])
    expect(changes).toEqual([
      { recordings: [placed], toots: [], deleted: { recordings: [], toots: [] } }
    ])
    // Read again unchanged, it changes nothing.
    account.place(recording.id, 48)
    changes.length = 0
    await page.sync.syncOnce('user-a')
    expect(changes).toEqual([])
  })

  it("shows another browser's placement on the screen's Recordings, with this browser's analysis", async () => {
    const placedThere = theirs(1)
    const deletedThere = theirs(2)
    account.add('recordings', placedThere, wav(5))
    account.add('recordings', deletedThere, wav(6))
    await page.sync.syncOnce('user-a')
    // What the screen holds: this browser's own analysis, still running.
    const analysis = { state: 'analyzing' } as const
    const shown = [{ ...placedThere, analysis }, deletedThere]
    account.place(placedThere.id, 48)
    account.remove('recordings', deletedThere.id)
    const added = theirs(3)
    account.add('recordings', added, wav(7))
    const changes: LibraryChange[] = []
    page.sync.onLibraryChanged(change => changes.push(change))
    await page.sync.syncOnce('user-a')
    const [change] = changes
    if (!change || change.reset) throw new Error('no change')
    expect(page.sync.recordingsAfter(shown, change)).toEqual([
      { ...placedThere, analysis, placedPitch: 48 },
      added
    ])
  })

  it('keeps a Placed Pitch this browser is sending, and reads none from an older Worker as none', async () => {
    const recording = theirs()
    account.add('recordings', { ...recording, placedPitch: 40 }, wav(5))
    await page.sync.syncOnce('user-a')
    expect((await page.store.loadRecordings())[0].placedPitch).toBe(40)
    refuse('PATCH', 503, 'unavailable')
    await page.store.placeRecording(recording.id, { placedPitch: 41 })
    account.place(recording.id, 42)
    await page.sync.syncOnce('user-a')
    expect((await page.store.loadRecordings())[0].placedPitch).toBe(41)
    // A Worker from before #268 lists the Recording without a Placed Pitch.
    account.intercept = null
    await page.sync.syncOnce('user-a')
    account.add('recordings', recording, wav(5))
    await page.sync.syncOnce('user-a')
    expect((await page.store.loadRecordings())[0].placedPitch).toBe(41)
  })

  it("keeps another browser's Trim, on the screen's Recordings too, but not over one it is sending", async () => {
    const recording = theirs()
    account.add('recordings', recording, wav(5))
    await page.sync.syncOnce('user-a')
    const shown = [{ ...recording, analysis: { state: 'analyzing' } as const }]
    const trim = { startSeconds: 0.2, endSeconds: 0.6 }
    account.placeAndTrim(recording.id, { trim })
    const changes: LibraryChange[] = []
    page.sync.onLibraryChanged(change => changes.push(change))
    await page.sync.syncOnce('user-a')
    expect((await page.store.loadRecordings())[0].trim).toEqual(trim)
    const [change] = changes
    if (!change || change.reset) throw new Error('no change')
    expect(page.sync.recordingsAfter(shown, change)).toEqual([{ ...shown[0], trim }])
    // Read again unchanged, it changes nothing.
    account.placeAndTrim(recording.id, { trim: { ...trim } })
    changes.length = 0
    await page.sync.syncOnce('user-a')
    expect(changes).toEqual([])

    refuse('PATCH', 503, 'unavailable')
    await page.store.placeRecording(recording.id, { trim: null })
    account.placeAndTrim(recording.id, { trim: { startSeconds: 0.3, endSeconds: 0.5 } })
    await page.sync.syncOnce('user-a')
    expect((await page.store.loadRecordings())[0].trim).toBeNull()
    // A Worker from before #293 lists the Recording without a Trim: it stays.
    account.intercept = null
    await page.sync.syncOnce('user-a')
    account.add('recordings', recording, wav(5))
    await page.sync.syncOnce('user-a')
    expect((await page.store.loadRecordings())[0].trim).toBeNull()
  })

  // A browser away longer than tombstones are kept reads everything, and can't be told what went.
  it("drops what the account no longer has after a full read, but not what's waiting to upload", async () => {
    const gone = theirs()
    account.add('recordings', gone, wav(5))
    await page.sync.syncOnce('user-a')
    const waiting = await recorded(3, false)
    account.remove('recordings', gone.id)
    account.advance(31 * 24 * 60 * 60 * 1000)
    account.expireTombstones()
    await page.sync.syncOnce('user-a')
    expect((await page.store.loadRecordings()).map(r => r.id)).toEqual([waiting.id])
  })

  it('downloads every WAV it waits for in the background', async () => {
    const recordings = [theirs(1), theirs(2)]
    for (const [i, recording] of recordings.entries()) account.add('recordings', recording, wav(i))
    await page.sync.syncOnce('user-a')
    await page.sync.downloadAll(() => false)
    const database = await page.store.db()
    expect(await database.count('downloads')).toBe(0)
    expect(bytes(await database.get('audio', recordings[1].id))).toEqual(bytes(wav(1)))
  })

  it('marks a Toot missing once the account turns out to have lost its WAV', async () => {
    const made = toot()
    account.add('toots', made, null)
    await page.sync.syncOnce('user-a')
    expect((await page.toots.loadToots())[0].isAudioMissing).toBeUndefined()
    await expect(page.toots.loadTootAudio(made.id)).rejects.toBeInstanceOf(
      page.toots.TootAudioMissing
    )
    expect((await page.toots.loadToots())[0].isAudioMissing).toBe(true)
  })

  // A sign-in in another tab claims the library for its account while this one reads.
  it('applies nothing it read once the library is claimed by another account', async () => {
    account.add('recordings', theirs(), wav(5))
    account.intercept = () => {
      claimedBy('user-b')
      return undefined
    }
    await page.sync.syncOnce('user-a')
    expect(await page.store.loadRecordings()).toEqual([])
    expect(await (await page.store.db()).get('meta', 'cursor')).toBeUndefined()
  })

  it('never brings back a Recording deleted while its WAV downloaded', async () => {
    const recording = theirs()
    account.add('recordings', recording, wav(5))
    await page.sync.syncOnce('user-a')
    account.intercept = async sent => {
      if (sent.path.endsWith('/audio/')) await page.store.deleteRecording(recording.id)
      return undefined
    }
    await page.sync.downloadAll(() => false)
    const database = await page.store.db()
    expect(await page.store.loadRecordings()).toEqual([])
    expect(await database.get('audio', recording.id)).toBeUndefined()
  })

  it("plays nothing it couldn't download, and tries again next time", async () => {
    const made = toot()
    account.add('toots', made, wav(6))
    await page.sync.syncOnce('user-a')
    account.offline = true
    await expect(page.toots.loadTootAudio(made.id)).rejects.not.toBeInstanceOf(
      page.toots.TootAudioMissing
    )
    account.offline = false
    expect(bytes(await page.toots.loadTootAudio(made.id))).toEqual(bytes(wav(6)))
  })
})

describe('libraryPulled', () => {
  it('is the account once its changes are read, after the screens hear them, until the library is cleared', async () => {
    await page.sync.claimLibrary('user-a', 'a@example.com')
    account.add('recordings', theirs(), wav(5))
    const heard: string[] = []
    page.sync.onLibraryChanged(() => heard.push('change'))
    page.sync.onLibraryPulled(() => heard.push(`pulled ${page.sync.libraryPulled()}`))
    expect(page.sync.libraryPulled()).toBeNull()
    await page.sync.syncOnce('user-a')
    expect(page.sync.libraryPulled()).toBe('user-a')
    expect(heard).toEqual(['change', 'pulled user-a'])
    // Sign out clears it, so signing in again waits for the account's next read.
    await page.sync.forgetLibrary()
    expect(page.sync.libraryPulled()).toBeNull()
  })

  it('stays null when the read fails, and goes with another account’s claim', async () => {
    await page.sync.claimLibrary('user-a')
    refuse('GET', 503, 'unavailable')
    await page.sync.syncOnce('user-a')
    expect(page.sync.libraryPulled()).toBeNull()
    account.intercept = () => undefined
    await page.sync.syncOnce('user-a')
    expect(page.sync.libraryPulled()).toBe('user-a')
    await page.sync.claimLibrary('user-b')
    expect(page.sync.libraryPulled()).toBeNull()
  })
})

describe('forgetLibrary', () => {
  it('clears this browser, forgets whose library it was, and tells the other tabs', async () => {
    await page.sync.claimLibrary('user-a', 'a@example.com')
    await recorded()
    const changes: LibraryChange[] = []
    page.sync.onLibraryChanged(change => changes.push(change))
    await page.sync.forgetLibrary()
    expect(localStorage.getItem('pedos.account')).toBeNull()
    expect(localStorage.getItem('pedos.account.email')).toBeNull()
    expect(await page.store.loadRecordings()).toEqual([])
    expect(changes).toEqual([{ reset: true }])
  })

  // A guest's library uploads when they sign in (#203, #237): an account's left here as a guest's
  // would upload to the next account signed in to.
  it("keeps the library the account's when the clear fails", async () => {
    await page.sync.claimLibrary('user-a', 'a@example.com')
    const recording = await recorded()
    const original = IDBObjectStore.prototype.clear
    // As a full disk does: the transaction aborts once its requests are made.
    IDBObjectStore.prototype.clear = function (this: IDBObjectStore) {
      const request = original.call(this)
      queueMicrotask(() => {
        try {
          this.transaction.abort()
        } catch {
          // Aborted already.
        }
      })
      return request
    }
    try {
      await page.sync.forgetLibrary()
    } finally {
      IDBObjectStore.prototype.clear = original
    }
    expect(localStorage.getItem('pedos.account')).toBe('user-a')
    expect((await page.store.loadRecordings()).map(r => r.id)).toEqual([recording.id])
  })
})

describe('a guest who records, then signs in', () => {
  // The account step comes after the first Result (#150): a new browser's first Recording is a
  // guest's Recording 1, and the account may have its own.
  it("numbers the guest's Recordings after the account's, here and on the account", async () => {
    const first = await recorded(1)
    const second = await recorded(2)
    expect([first.number, second.number]).toEqual([1, 2])
    account.add('recordings', theirs(1), wav(5))
    account.add('recordings', theirs(2), wav(6))
    account.add('recordings', theirs(3), wav(7))
    const changes: LibraryChange[] = []
    page.sync.onLibraryChanged(change => changes.push(change))

    expect(await page.sync.claimLibrary('user-a', 'a@example.com')).toBe(true)
    await page.sync.syncOnce('user-a')

    const numbers = (await page.store.loadRecordings()).map(r => r.number)
    expect(numbers).toEqual([1, 2, 3, 4, 5])
    expect(account.get('recordings', first.id)?.item).toMatchObject({ number: 4 })
    expect(account.get('recordings', second.id)?.item).toMatchObject({ number: 5 })
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({
      recordings: expect.arrayContaining([
        expect.objectContaining({ id: first.id, number: 4 }),
        expect.objectContaining({ id: second.id, number: 5 })
      ])
    })
  })

  it('keeps the numbers of Recordings that already come after the account’s', async () => {
    const mine = await recorded(1)
    await recorded(2)
    await page.store.deleteRecording(mine.id)
    account.add('recordings', theirs(1), wav(5))
    await page.sync.claimLibrary('user-a')
    await page.sync.syncOnce('user-a')
    expect((await page.store.loadRecordings()).map(r => r.number)).toEqual([1, 2])
  })
})

describe('unsavedBeforeSignIn', () => {
  it('counts the farts not uploaded that signing in to another account would clear', async () => {
    await page.sync.claimLibrary('user-a', 'a@example.com')
    await recorded(1)
    await page.toots.saveToot(toot(), wav(9))
    expect(await page.sync.unsavedBeforeSignIn('b@example.com')).toBe(2)
    // The same account keeps them, however its email is typed.
    expect(await page.sync.unsavedBeforeSignIn(' A@example.COM ')).toBe(0)
  })

  it('counts nothing for a guest, or once everything uploaded', async () => {
    await recorded(1)
    expect(await page.sync.unsavedBeforeSignIn('b@example.com')).toBe(0)
    await page.sync.claimLibrary('user-a', 'a@example.com')
    await page.sync.syncOnce('user-a')
    expect(await page.sync.unsavedBeforeSignIn('b@example.com')).toBe(0)
  })

  it("counts a library's farts whose account's email isn't known", async () => {
    claimedBy('user-a')
    await recorded(1)
    expect(await page.sync.unsavedBeforeSignIn('a@example.com')).toBe(1)
  })
})
