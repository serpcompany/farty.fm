import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account } from './account'
import { blockedStorage, memoryStorage } from './test-storage'
import { clearsOnOpen, type OpenFacts } from './visit'

const { clearLibrary } = vi.hoisted(() => ({ clearLibrary: vi.fn(async () => {}) }))
vi.mock('./recording-store', () => ({ clearLibrary }))

const guestsNewVisit: OpenFacts = {
  account: { status: 'signedOut' },
  firstOpen: false,
  otherTabOpen: false
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

  it('keeps what a browser held from before guests kept nothing, for this visit', () => {
    expect(clearsOnOpen({ ...guestsNewVisit, firstOpen: true })).toBe(false)
  })

  it('keeps them while Pedos is open in another tab', () => {
    expect(clearsOnOpen({ ...guestsNewVisit, otherTabOpen: true })).toBe(false)
  })
})

describe('openVisit', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage())
    // No Web Locks: no other tab is open.
    vi.stubGlobal('navigator', {})
    clearLibrary.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const signedOut = () => Response.json(null)
  const signedIn = () =>
    Response.json({ session: {}, user: { id: 'user-a', email: 'a@example.com' } })

  /** Opens Pedos in a new tab (or `tab`, for a reload), with get-session answering `session`. */
  async function open(
    session: () => Response | Error,
    tab: Storage = memoryStorage()
  ): Promise<Account> {
    vi.stubGlobal('sessionStorage', tab)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const answer = session()
        if (answer instanceof Error) throw answer
        return answer
      })
    )
    // `openVisit` starts once a page: a fresh module is a fresh page.
    vi.resetModules()
    const { openVisit } = await import('./visit')
    const visit = openVisit()
    await visit.library
    return visit.account
  }

  /** A browser that has had a guest's visit since guests keep nothing. */
  const pastFirstOpen = () => localStorage.setItem('pedos.opened', '1')

  it("clears a guest's last visit as a new one opens", async () => {
    pastFirstOpen()
    expect(await open(signedOut)).toEqual({ status: 'signedOut' })
    expect(clearLibrary).toHaveBeenCalledTimes(1)
  })

  it("keeps an account's farts when its session has ended, and asks to sign in again", async () => {
    pastFirstOpen()
    await open(signedIn)
    expect(await open(signedOut)).toEqual({ status: 'expired' })
    expect(clearLibrary).not.toHaveBeenCalled()
  })

  // Signed in, the library is the account's before it loads (`claimLibrary`).
  it("makes a guest's library the account's as a signed-in visit opens", async () => {
    await open(signedIn)
    expect(localStorage.getItem('pedos.account')).toBe('user-a')
    expect(clearLibrary).not.toHaveBeenCalled()
  })

  it("clears another account's library before a signed-in visit loads it", async () => {
    localStorage.setItem('pedos.account', 'user-b')
    await open(signedIn)
    expect(clearLibrary).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('pedos.account')).toBe('user-a')
  })

  // Without sessionStorage, Pedos can't tell a reload from a new visit.
  it('clears nothing when sessionStorage is blocked', async () => {
    pastFirstOpen()
    await open(signedOut, blockedStorage())
    expect(clearLibrary).not.toHaveBeenCalled()
  })

  it('keeps the visit through a reload', async () => {
    pastFirstOpen()
    const tab = memoryStorage()
    await open(signedOut, tab)
    await open(signedOut, tab)
    expect(clearLibrary).toHaveBeenCalledTimes(1)
  })

  // The first open's grace is for an open that can say farts go at the end of the visit.
  it.each([
    ['answers 503', () => new Response('no secret', { status: 503 })],
    ['answers 500', () => new Response('oops', { status: 500 })],
    ['is offline', () => new TypeError('Failed to fetch')]
  ])('keeps the first open for the next readable one when get-session %s', async (_, unreadable) => {
    expect(await open(unreadable)).toEqual({ status: 'unreachable' })
    expect(localStorage.getItem('pedos.opened')).toBeNull()
    // Read at last: the warned open, which keeps what's here.
    await open(signedOut)
    expect(clearLibrary).not.toHaveBeenCalled()
    expect(localStorage.getItem('pedos.opened')).toBe('1')
    // The next visit is a guest's like any other.
    await open(signedOut)
    expect(clearLibrary).toHaveBeenCalledTimes(1)
  })
})
