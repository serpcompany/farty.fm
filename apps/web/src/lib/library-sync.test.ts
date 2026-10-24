import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryChange } from './library-sync'
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

  // A guest's Recordings are kept (#203): an account's left here as a guest's would upload to the
  // next account signed in to.
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
