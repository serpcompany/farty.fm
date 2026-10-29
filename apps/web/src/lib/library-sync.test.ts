import { describe, expect, it, vi } from 'vitest'
import type { LibraryChange } from '@/lib/library-changes'
import {
  anotherBrowsersRecording,
  claimedBy,
  libraryHarness,
  newToot,
  wav
} from '@/test-support/library-page'
import { blockedStorage } from '@/test-support/web-storage'

const library = libraryHarness()
const { recorded, outbox } = library

describe('claimLibrary', () => {
  it("makes a guest's library the account's, keeping it", async () => {
    await recorded()
    expect(await library.page.sync.claimLibrary('user-a')).toBe(true)
    expect(localStorage.getItem('pedos.account')).toBe('user-a')
    expect(await library.page.store.loadRecordings()).toHaveLength(1)
  })

  it("clears another account's library first, so it never uploads to this one", async () => {
    claimedBy('user-b')
    await recorded()
    const changes: LibraryChange[] = []
    library.page.changes.onLibraryChanged(change => changes.push(change))
    expect(await library.page.sync.claimLibrary('user-a')).toBe(true)
    expect(await library.page.store.loadRecordings()).toEqual([])
    expect(await outbox()).toEqual([])
    expect(changes).toContainEqual({ reset: true })
    expect(localStorage.getItem('pedos.account')).toBe('user-a')
  })

  it('keeps a library claimed before ids were kept', async () => {
    claimedBy('1')
    await recorded()
    expect(await library.page.sync.claimLibrary('user-a')).toBe(true)
    expect(await library.page.store.loadRecordings()).toHaveLength(1)
  })

  it("remembers the account's email, and forgets another account's", async () => {
    expect(await library.page.sync.claimLibrary('user-a', ' A@Example.com ')).toBe(true)
    expect(localStorage.getItem('pedos.account.email')).toBe('a@example.com')
    expect(await library.page.sync.claimLibrary('user-a')).toBe(true)
    expect(localStorage.getItem('pedos.account.email')).toBe('a@example.com')
    expect(await library.page.sync.claimLibrary('user-b')).toBe(true)
    expect(localStorage.getItem('pedos.account.email')).toBeNull()
  })

  it("claims nothing without an id, or where it can't remember whose it is", async () => {
    expect(await library.page.sync.claimLibrary('')).toBe(false)
    vi.stubGlobal('localStorage', blockedStorage())
    expect(await library.page.sync.claimLibrary('user-a')).toBe(false)
  })
})

describe('forgetLibrary', () => {
  it('clears this browser, forgets whose library it was, and tells the other tabs', async () => {
    await library.page.sync.claimLibrary('user-a', 'a@example.com')
    await recorded()
    const changes: LibraryChange[] = []
    library.page.changes.onLibraryChanged(change => changes.push(change))
    await library.page.sync.forgetLibrary()
    expect(localStorage.getItem('pedos.account')).toBeNull()
    expect(localStorage.getItem('pedos.account.email')).toBeNull()
    expect(await library.page.store.loadRecordings()).toEqual([])
    expect(changes).toEqual([{ reset: true }])
  })

  it("keeps the library the account's when the clear fails", async () => {
    await library.page.sync.claimLibrary('user-a', 'a@example.com')
    const recording = await recorded()
    const original = IDBObjectStore.prototype.clear
    IDBObjectStore.prototype.clear = function (this: IDBObjectStore) {
      const request = original.call(this)
      queueMicrotask(() => {
        try {
          this.transaction.abort()
        } catch {}
      })
      return request
    }
    try {
      await library.page.sync.forgetLibrary()
    } finally {
      IDBObjectStore.prototype.clear = original
    }
    expect(localStorage.getItem('pedos.account')).toBe('user-a')
    expect((await library.page.store.loadRecordings()).map(r => r.id)).toEqual([recording.id])
  })
})

describe('a guest who records, then signs in', () => {
  it("numbers the guest's Recordings after the account's, here and on the account", async () => {
    const first = await recorded(1)
    const second = await recorded(2)
    expect([first.number, second.number]).toEqual([1, 2])
    library.account.add('recordings', anotherBrowsersRecording(1), wav(5))
    library.account.add('recordings', anotherBrowsersRecording(2), wav(6))
    library.account.add('recordings', anotherBrowsersRecording(3), wav(7))
    const changes: LibraryChange[] = []
    library.page.changes.onLibraryChanged(change => changes.push(change))

    expect(await library.page.sync.claimLibrary('user-a', 'a@example.com')).toBe(true)
    await library.page.sync.syncOnce('user-a')

    const numbers = (await library.page.store.loadRecordings()).map(r => r.number)
    expect(numbers).toEqual([1, 2, 3, 4, 5])
    expect(library.account.get('recordings', first.id)?.item).toMatchObject({ number: 4 })
    expect(library.account.get('recordings', second.id)?.item).toMatchObject({ number: 5 })
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
    await library.page.store.deleteRecording(mine.id)
    library.account.add('recordings', anotherBrowsersRecording(1), wav(5))
    await library.page.sync.claimLibrary('user-a')
    await library.page.sync.syncOnce('user-a')
    expect((await library.page.store.loadRecordings()).map(r => r.number)).toEqual([1, 2])
  })
})

describe('unsavedBeforeSignIn', () => {
  it('counts the farts not uploaded that signing in to another account would clear', async () => {
    await library.page.sync.claimLibrary('user-a', 'a@example.com')
    await recorded(1)
    await library.page.toots.saveToot(newToot(), wav(9))
    expect(await library.page.sync.unsavedBeforeSignIn('b@example.com')).toBe(2)
    expect(await library.page.sync.unsavedBeforeSignIn(' A@example.COM ')).toBe(0)
  })

  it('counts nothing for a guest, or once everything uploaded', async () => {
    await recorded(1)
    expect(await library.page.sync.unsavedBeforeSignIn('b@example.com')).toBe(0)
    await library.page.sync.claimLibrary('user-a', 'a@example.com')
    await library.page.sync.syncOnce('user-a')
    expect(await library.page.sync.unsavedBeforeSignIn('b@example.com')).toBe(0)
  })

  it("counts a library's farts whose account's email isn't known", async () => {
    claimedBy('user-a')
    await recorded(1)
    expect(await library.page.sync.unsavedBeforeSignIn('a@example.com')).toBe(1)
  })
})
