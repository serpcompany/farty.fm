import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FakeAccount } from '@/test-support/fake-account'
import {
  newToot,
  openLibraryPage,
  saveRecordingOn,
  stubLibraryBrowser,
  wav
} from '@/test-support/library-page'
import { blockedStorage, memoryStorage } from '@/test-support/web-storage'
import type { Account } from './account'
import { itemKey } from './outbox'
import type { Recording } from './recordings'
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

describe('openVisit', () => {
  let account: FakeAccount

  beforeEach(() => {
    account = stubLibraryBrowser()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  const signedOut = () => Response.json(null)
  const signedInAs = (id: string) => () =>
    Response.json({ session: {}, user: { id, email: `${id}@example.com` } })
  const signedIn = signedInAs('user-a')

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
    const page = {
      ...(await openLibraryPage()),
      visit: await import('./visit'),
      signIn: await import('./account')
    }
    const visit = page.visit.openVisit()
    await visit.library
    return { ...page, account: await visit.account }
  }

  type Page = Awaited<ReturnType<typeof open>>

  async function makeFarts(page: Page): Promise<{ recording: Recording; toot: Toot }> {
    const recording = await saveRecordingOn(page)
    const toot: Toot = {
      ...newToot(),
      arrangement: { transposition: 0, recordingForPitch: { 55: recording.id } }
    }
    await page.toots.saveToot(toot, wav(9))
    return { recording, toot }
  }

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

  const pastFirstOpen = () => localStorage.setItem('pedos.opened', '1')
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
    expect((await held(await open(signedOut))).recordings).toEqual([])
  })

  async function sendACode(page: Page) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ success: true }))
    )
    expect(await page.signIn.sendCode('a@example.com', 'token')).toMatchObject({ ok: true })
  }

  it("keeps a guest's farts on a new visit while the code they were sent still works", async () => {
    pastFirstOpen()
    const page = await open(signedOut)
    const { recording, toot } = await makeFarts(page)
    await sendACode(page)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 9 * 60_000)
    const relaunched = await open(signedOut)
    expect(await held(relaunched)).toMatchObject({ recordings: [recording.id], toots: [toot.id] })
    vi.setSystemTime(Date.now() + 2 * 60_000)
    expect(await held(await open(signedOut))).toMatchObject({ recordings: [], toots: [] })
  })

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
    localStorage.setItem('pedos.accountStep', 'once')
    await open(signedOut)
    expect(localStorage.getItem('pedos.accountStep')).toBe('once')
  })

  it("uploads a guest's Recordings as they sign in, those kept from before #237 included", async () => {
    pastFirstOpen()
    const { recording: before } = await makeFartsBefore237(await open(signedOut))
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
    expect((await held(await open(signedIn))).recordings).toEqual([before.id, since.id].sort())
  })

  it("clears a library an account left as a guest's, from before #203, as a guest's visit opens", async () => {
    pastFirstOpen()
    const signedInVisit = await open(signedIn)
    const { recording } = await makeFarts(signedInVisit)
    await signedInVisit.sync.syncOnce('user-a')
    expect(account.get('recordings', recording.id)).toBeDefined()
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

  it('clears nothing when sessionStorage is blocked', async () => {
    pastFirstOpen()
    const { recording, toot } = await makeFarts(await open(signedOut))
    const blocked = await open(signedOut, blockedStorage())
    expect(await held(blocked)).toMatchObject({ recordings: [recording.id], toots: [toot.id] })
  })

  it.each([
    ['answers 503', () => new Response('no secret', { status: 503 })],
    ['answers 500', () => new Response('oops', { status: 500 })],
    ['is offline', () => new TypeError('Failed to fetch')]
  ])('keeps the first open for the next readable one when get-session %s', async (_, unreadable) => {
    const unread = await open(unreadable)
    expect(unread.account).toEqual({ status: 'unreachable' })
    expect(localStorage.getItem('pedos.opened')).toBeNull()
    const { recording, toot } = await makeFarts(unread)
    const warned = await open(signedOut)
    expect(await held(warned)).toMatchObject({ recordings: [recording.id], toots: [toot.id] })
    expect(localStorage.getItem('pedos.opened')).toBe('1')
    const next = await open(signedOut)
    expect(await held(next)).toMatchObject({ recordings: [], toots: [] })
  })
})
