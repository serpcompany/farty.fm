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
  otherTabOpen: false,
  signingUp: false
}

describe('clearsOnOpen', () => {
  it("clears a guest's farts when a new visit opens", () => {
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

  it('keeps them while the sign-in code sent from this browser still works', () => {
    expect(clearsOnOpen({ ...guestsNewVisit, signingUp: true })).toBe(false)
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
    vi.useRealTimers()
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
      signIn: await import('./account'),
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
  /**
   * Makes farts as a build from before #237 did: Farty hasn't opened since, so it hasn't noted
   * which Recordings this browser keeps.
   */
  async function makeFartsBefore237(page: Page) {
    const farts = await makeFarts(page)
    localStorage.removeItem('pedos.keptRecordings')
    return farts
  }
  const nothing = { recordings: [], audio: [], toots: [], tootAudio: [], outbox: [] }

  it("clears a guest's Recordings, their audio and their Toots as a new visit opens", async () => {
    pastFirstOpen()
    const last = await open(signedOut)
    const { recording, toot } = await makeFarts(last)
    // Something waits to download for each, as for a library an account left (`forgetLibrary`
    // clears those): each goes with its fart.
    const database = await last.store.db()
    await database.put(
      'downloads',
      { kind: 'recordings', id: recording.id },
      itemKey('recordings', recording.id)
    )
    await database.put('downloads', { kind: 'toots', id: toot.id }, itemKey('toots', toot.id))

    const next = await open(signedOut)
    expect(next.account).toEqual({ status: 'signedOut' })
    expect(await held(next)).toEqual(nothing)
    expect(await (await next.store.db()).getAllKeys('downloads')).toEqual([])
    expect(await next.store.loadRecordings()).toEqual([])
  })

  it('keeps the Recordings a browser held from before #237, and clears those made since', async () => {
    pastFirstOpen()
    const { recording: before } = await makeFartsBefore237(await open(signedOut))
    // The first open since: the last visit's Toot goes, and its Recording is kept from now on.
    const first = await open(signedOut)
    expect(JSON.parse(localStorage.getItem('pedos.keptRecordings') ?? '')).toEqual([before.id])
    expect(await held(first)).toMatchObject({ recordings: [before.id], toots: [] })
    const { recording: since } = await makeFarts(first)
    expect(since.number).toBe(2)

    const next = await open(signedOut)
    expect(await held(next)).toEqual({
      recordings: [before.id],
      audio: [before.id],
      toots: [],
      tootAudio: [],
      outbox: [itemKey('recordings', before.id)]
    })
    expect(await next.store.loadAudio(before.id)).toEqual(wav(1))
    // Closed and opened again: still there.
    const after = await open(signedOut)
    expect((await after.store.loadRecordings()).map(r => r.id)).toEqual([before.id])
  })

  it('keeps every Recording when the kept ones can’t be read', async () => {
    pastFirstOpen()
    const { recording } = await makeFarts(await open(signedOut))
    localStorage.setItem('pedos.keptRecordings', '{oops')
    const next = await open(signedOut)
    expect(await held(next)).toMatchObject({ recordings: [recording.id], toots: [] })
  })

  it('clears nothing on a reload', async () => {
    pastFirstOpen()
    const tab = memoryStorage()
    const first = await open(signedOut, tab)
    const { recording, toot } = await makeFarts(first)
    const reloaded = await open(signedOut, tab)
    expect(await held(reloaded)).toEqual({
      recordings: [recording.id],
      audio: [recording.id],
      toots: [toot.id],
      tootAudio: [toot.id],
      outbox: [itemKey('recordings', recording.id), itemKey('toots', toot.id)].sort()
    })
  })

  // A clear can throw, such as when WebKit's lost IndexedDB connection fails twice (`withDb`). The
  // visit has still started, so a reload keeps what the guest makes in it.
  it("clears nothing on a reload after the clear at open failed, so this visit's Recordings stay", async () => {
    pastFirstOpen()
    const { recording: last } = await makeFarts(await open(signedOut))
    const tab = memoryStorage()
    vi.doMock('./library-sync', async importOriginal => ({
      ...(await importOriginal<typeof import('./library-sync')>()),
      leftByAnAccount: () => Promise.reject(new Error('library-connection-lost'))
    }))
    const failed = await open(signedOut, tab)
    vi.doUnmock('./library-sync')
    expect((await held(failed)).recordings).toEqual([last.id])
    const { recording } = await makeFarts(failed)

    const reloaded = await open(signedOut, tab)
    expect((await held(reloaded)).recordings).toEqual([last.id, recording.id].sort())
    // The next visit clears them both, since neither is kept.
    expect((await held(await open(signedOut))).recordings).toEqual([])
  })

  /** The account step sends a sign-in code, as `sendNow` does. */
  async function sendACode(page: Page) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ success: true }))
    )
    expect(await page.signIn.sendCode('a@example.com', 'token')).toMatchObject({ ok: true })
  }

  // A home-screen app that iOS ends while the guest reads their code in Mail may open again with
  // empty sessionStorage: a new visit, which mustn't clear the farts they're signing up to keep.
  it("keeps a guest's farts on a new visit while the code they were sent still works", async () => {
    pastFirstOpen()
    const page = await open(signedOut)
    const { recording, toot } = await makeFarts(page)
    await sendACode(page)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 9 * 60_000)
    const relaunched = await open(signedOut)
    expect(await held(relaunched)).toMatchObject({ recordings: [recording.id], toots: [toot.id] })
    // Once the code no longer works, a new visit clears them as any guest's.
    vi.setSystemTime(Date.now() + 2 * 60_000)
    expect(await held(await open(signedOut))).toMatchObject({ recordings: [], toots: [] })
  })

  // Told before #237 that their Recordings stay, they get one more offer, at their next Result.
  it.each([
    ['offers the step once more to a guest whose Recordings are kept', 'guest', true, null],
    ['leaves it for a guest with no Recordings to keep', 'guest', false, 'once'],
    ["leaves it for an account's browser", 'account', true, 'done']
  ] as const)('%s, as it first opens since #237', async (_, whose, farts, step) => {
    pastFirstOpen()
    const page = await open(whose === 'guest' ? signedOut : signedIn)
    if (farts) await makeFartsBefore237(page)
    else localStorage.removeItem('pedos.keptRecordings')
    localStorage.setItem('pedos.accountStep', whose === 'guest' ? 'once' : 'done')
    await open(whose === 'guest' ? signedOut : signedIn)
    expect(localStorage.getItem('pedos.accountStep')).toBe(step)
    // Only that first open: the next leaves the offer as it is.
    localStorage.setItem('pedos.accountStep', 'once')
    await open(signedOut)
    expect(localStorage.getItem('pedos.accountStep')).toBe('once')
  })

  it("uploads a guest's Recordings as they sign in, those kept from before #237 included", async () => {
    pastFirstOpen()
    const { recording: before } = await makeFartsBefore237(await open(signedOut))
    // A later visit, which makes another, then signs in (reloaded here, in the same tab).
    const tab = memoryStorage()
    const { recording: since } = await makeFarts(await open(signedOut, tab))
    const signedInVisit = await open(signedIn, tab)
    expect(localStorage.getItem('pedos.account')).toBe('user-a')
    expect((await held(signedInVisit)).recordings).toEqual([before.id, since.id].sort())

    await signedInVisit.sync.syncOnce('user-a')
    expect(account.get('recordings', before.id)?.wav).toEqual(wav(1))
    expect(account.get('recordings', since.id)?.wav).toEqual(wav(1))
    const puts = account.sent
      .filter(sent => sent.method === 'PUT' && sent.path.startsWith('/api/recordings/'))
      .map(sent => sent.path)
    expect(puts.sort()).toEqual(
      [`/api/recordings/${before.id}/`, `/api/recordings/${since.id}/`].sort()
    )
    // Signed in, a new visit keeps them all.
    expect((await held(await open(signedIn))).recordings).toEqual([before.id, since.id].sort())
  })

  it("clears a library an account left as a guest's, from before #203, as a guest's visit opens", async () => {
    pastFirstOpen()
    const signedInVisit = await open(signedIn)
    const { recording } = await makeFarts(signedInVisit)
    await signedInVisit.sync.syncOnce('user-a')
    expect(account.get('recordings', recording.id)).toBeDefined()
    // A Sign out before #203 whose clear failed: the account forgotten, its library left.
    localStorage.removeItem('pedos.account')

    const guest = await open(signedOut)
    expect(await held(guest)).toEqual(nothing)
    expect(await (await guest.store.db()).getAllKeys('meta')).toEqual([])
  })

  it("clears another account's library before a signed-in visit loads it", async () => {
    await open(signedInAs('user-b'))
    const theirs = await open(signedInAs('user-b'))
    await makeFarts(theirs)
    expect(localStorage.getItem('pedos.account')).toBe('user-b')

    const mine = await open(signedIn)
    expect(localStorage.getItem('pedos.account')).toBe('user-a')
    expect(await held(mine)).toEqual(nothing)
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
    const { recording, toot } = await makeFarts(await open(signedOut))
    const blocked = await open(signedOut, blockedStorage())
    expect(await held(blocked)).toMatchObject({ recordings: [recording.id], toots: [toot.id] })
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
    expect(await held(warned)).toMatchObject({ recordings: [recording.id], toots: [toot.id] })
    expect(localStorage.getItem('pedos.opened')).toBe('1')
    // The next visit is a guest's like any other.
    const next = await open(signedOut)
    expect(await held(next)).toMatchObject({ recordings: [], toots: [] })
  })
})
