import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account } from './account'
import { itemKey } from './outbox'
import type { Recording } from './recordings'
import { type FakeAccount, fakeAccount } from './test-library'
import { blockedStorage, memoryStorage } from './test-storage'
import type { Toot } from './toot'
import { clearsOnOpen, type OpenFacts } from './visit'

const guestsNewVisit: OpenFacts = {
  account: { status: 'signedOut' },
  firstOpen: false,
  otherTabOpen: false
}

describe('clearsOnOpen', () => {
  it("clears a guest's Toots when a new visit opens", () => {
    expect(clearsOnOpen(guestsNewVisit)).toBe(true)
  })

  it.each<Account>([
    { status: 'signedIn', id: 'user-a', email: 'a@example.com', marketingEmail: true },
    { status: 'expired' },
    { status: 'unreachable' },
    { status: 'checking' }
  ])('keeps them unless the session reads as signed out ($status)', account => {
    expect(clearsOnOpen({ ...guestsNewVisit, account })).toBe(false)
  })

  it("keeps what a browser held from before a guest's Toots lasted the visit, for this visit", () => {
    expect(clearsOnOpen({ ...guestsNewVisit, firstOpen: true })).toBe(false)
  })

  it('keeps them while Farty is open in another tab', () => {
    expect(clearsOnOpen({ ...guestsNewVisit, otherTabOpen: true })).toBe(false)
  })
})

// Each open over a real IndexedDB (fake-indexeddb) and a fake account (`test-library.ts`).
describe('openVisit', () => {
  let account: FakeAccount

  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    vi.stubGlobal('localStorage', memoryStorage())
    // No Web Locks: no other tab is open.
    vi.stubGlobal('navigator', {})
    account = fakeAccount('user-a')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const signedOut = () => Response.json(null)
  const signedInAs = (id: string) => () =>
    Response.json({ session: {}, user: { id, email: `${id}@example.com` } })
  const signedIn = signedInAs('user-a')

  /**
   * Opens Farty in a new tab (or `tab`, for a reload), with get-session answering `session` and
   * the rest going to user-a's account. Resolves once the library can load.
   */
  async function open(session: () => Response | Error, tab: Storage = memoryStorage()) {
    vi.stubGlobal('sessionStorage', tab)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        if (!input.startsWith('/api/auth/get-session')) return account.fetch(input, init)
        const answer = session()
        if (answer instanceof Error) throw answer
        return answer
      })
    )
    // `openVisit` starts once a page: fresh modules are a fresh page.
    vi.resetModules()
    const page = {
      visit: await import('./visit'),
      store: await import('./recording-store'),
      toots: await import('./toot-store'),
      sync: await import('./library-sync')
    }
    const visit = page.visit.openVisit()
    await visit.library
    return { ...page, account: await visit.account }
  }

  type Page = Awaited<ReturnType<typeof open>>

  const wav = (n: number) => new Uint8Array([82, 73, 70, 70, n, n, n]).buffer

  /** Saves a Recording, analyzed so it can upload, and a Toot made from it, as a person does. */
  async function makeFarts(page: Page): Promise<{ recording: Recording; toot: Toot }> {
    const saved = await page.store.saveRecording(
      { seconds: 1, sampleRate: 48_000, waveform: [0.5] },
      wav(1)
    )
    const recording = (await page.store.saveAnalysis(saved.id, {
      state: 'notAnalyzed'
    })) as Recording
    const toot: Toot = {
      id: crypto.randomUUID(),
      title: 'Mary Had a Little Lamb',
      songId: 'mary-had-a-little-lamb',
      createdAt: Date.now(),
      seconds: 3,
      arrangement: { transposition: 0, recordingForPitch: { 55: recording.id } }
    }
    await page.toots.saveToot(toot, wav(9))
    return { recording, toot }
  }

  /** What this browser holds: each store's keys. */
  async function held(page: Page) {
    const database = await page.store.db()
    const keys = async (name: 'recordings' | 'audio' | 'toots' | 'tootAudio' | 'outbox') =>
      (await database.getAllKeys(name)).sort()
    return {
      recordings: await keys('recordings'),
      audio: await keys('audio'),
      toots: await keys('toots'),
      tootAudio: await keys('tootAudio'),
      outbox: await keys('outbox')
    }
  }

  /** A browser that has had a guest's visit since a guest's Toots last only the visit. */
  const pastFirstOpen = () => localStorage.setItem('pedos.opened', '1')

  it("keeps a guest's Recordings as a new visit opens, and clears their Toots", async () => {
    pastFirstOpen()
    const last = await open(signedOut)
    const { recording, toot } = await makeFarts(last)
    // Something waits to download for each, as for a library an account left (`forgetLibrary`
    // clears those): the Toot's goes with it.
    const database = await last.store.db()
    await database.put('downloads', { kind: 'recordings', id: recording.id }, 'recordings:x')
    await database.put('downloads', { kind: 'toots', id: toot.id }, itemKey('toots', toot.id))

    const next = await open(signedOut)
    expect(next.account).toEqual({ status: 'signedOut' })
    expect(await held(next)).toEqual({
      recordings: [recording.id],
      audio: [recording.id],
      toots: [],
      tootAudio: [],
      outbox: [itemKey('recordings', recording.id)]
    })
    expect(await (await next.store.db()).getAllKeys('downloads')).toEqual(['recordings:x'])
    expect(await next.store.loadAudio(recording.id)).toEqual(wav(1))
    // Closed and opened again, and again: still there.
    const after = await open(signedOut)
    expect((await after.store.loadRecordings()).map(r => r.number)).toEqual([1])
  })

  it('keeps the Toots through a reload', async () => {
    pastFirstOpen()
    const tab = memoryStorage()
    const first = await open(signedOut, tab)
    const { toot } = await makeFarts(first)
    const reloaded = await open(signedOut, tab)
    expect((await held(reloaded)).toots).toEqual([toot.id])
  })

  it("makes a guest's kept Recordings the account's as a signed-in visit opens, and uploads them", async () => {
    pastFirstOpen()
    const { recording } = await makeFarts(await open(signedOut))
    // A later visit, then a sign-in.
    await open(signedOut)
    const signedInVisit = await open(signedIn)
    expect(localStorage.getItem('pedos.account')).toBe('user-a')
    expect((await held(signedInVisit)).recordings).toEqual([recording.id])

    await signedInVisit.sync.syncOnce('user-a')
    expect(account.get('recordings', recording.id)?.wav).toEqual(wav(1))
    const puts = account.sent.filter(sent => sent.method === 'PUT')
    expect(puts).toEqual([
      expect.objectContaining({ path: `/api/recordings/${recording.id}/`, library: 'user-a' })
    ])
  })

  it("clears another account's library before a signed-in visit loads it", async () => {
    await open(signedInAs('user-b'))
    const theirs = await open(signedInAs('user-b'))
    await makeFarts(theirs)
    expect(localStorage.getItem('pedos.account')).toBe('user-b')

    const mine = await open(signedIn)
    expect(localStorage.getItem('pedos.account')).toBe('user-a')
    expect(await held(mine)).toEqual({
      recordings: [],
      audio: [],
      toots: [],
      tootAudio: [],
      outbox: []
    })
  })

  it("keeps an account's farts when its session has ended, and asks to sign in again", async () => {
    pastFirstOpen()
    const signedInVisit = await open(signedIn)
    const { recording, toot } = await makeFarts(signedInVisit)
    const ended = await open(signedOut)
    expect(ended.account).toEqual({ status: 'expired' })
    expect(await held(ended)).toMatchObject({ recordings: [recording.id], toots: [toot.id] })
  })

  // Without sessionStorage, Farty can't tell a reload from a new visit.
  it('clears nothing when sessionStorage is blocked', async () => {
    pastFirstOpen()
    const { toot } = await makeFarts(await open(signedOut))
    const blocked = await open(signedOut, blockedStorage())
    expect((await held(blocked)).toots).toEqual([toot.id])
  })

  // The first open's grace is for an open that can say Toots go at the end of the visit.
  it.each([
    ['answers 503', () => new Response('no secret', { status: 503 })],
    ['answers 500', () => new Response('oops', { status: 500 })],
    ['is offline', () => new TypeError('Failed to fetch')]
  ])('keeps the first open for the next readable one when get-session %s', async (_, unreadable) => {
    const unread = await open(unreadable)
    expect(unread.account).toEqual({ status: 'unreachable' })
    expect(localStorage.getItem('pedos.opened')).toBeNull()
    const { recording, toot } = await makeFarts(unread)
    // Read at last: the warned open, which keeps what's here.
    const warned = await open(signedOut)
    expect((await held(warned)).toots).toEqual([toot.id])
    expect(localStorage.getItem('pedos.opened')).toBe('1')
    // The next visit is a guest's like any other.
    const next = await open(signedOut)
    expect(await held(next)).toMatchObject({ recordings: [recording.id], toots: [] })
  })
})
