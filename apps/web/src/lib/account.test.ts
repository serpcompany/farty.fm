import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearStepDraft,
  forgetAccount,
  libraryOwner,
  problemOf,
  readSession,
  readStepDraft,
  type StepOffers,
  saveStepDraft,
  setLibraryOwner,
  signIn,
  stepOffer,
  stopStepOffers,
  takeSignInAgain,
  takeStepOffer
} from './account'
import { blockedStorage, memoryStorage } from './test-storage'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('stepOffer', () => {
  it('offers at the first Result, then once after a saved Toot, then never', () => {
    let offers: StepOffers = null
    const seen: boolean[] = []
    for (const moment of ['result', 'result', 'toot', 'toot', 'result'] as const) {
      const { offer, next } = stepOffer(offers, moment)
      seen.push(offer)
      offers = next
    }
    expect(seen).toEqual([true, false, true, false, false])
    expect(offers).toBe('done')
  })

  it('offers after a saved Toot when no Result has offered it yet', () => {
    expect(stepOffer(null, 'toot')).toEqual({ offer: true, next: 'done' })
  })

  it('never offers once done', () => {
    expect(stepOffer('done', 'result').offer).toBe(false)
    expect(stepOffer('done', 'toot').offer).toBe(false)
  })
})

describe('takeStepOffer', () => {
  it('remembers each offer in localStorage', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    expect(takeStepOffer('result')).toBe(true)
    expect(localStorage.getItem('pedos.accountStep')).toBe('once')
    expect(takeStepOffer('result')).toBe(false)
    expect(takeStepOffer('toot')).toBe(true)
    expect(takeStepOffer('toot')).toBe(false)
  })

  it('never offers after signing in', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    stopStepOffers()
    expect(takeStepOffer('result')).toBe(false)
    expect(takeStepOffer('toot')).toBe(false)
  })

  it('never offers with storage blocked, since it could not remember', () => {
    vi.stubGlobal('localStorage', blockedStorage())
    expect(takeStepOffer('result')).toBe(false)
    expect(() => stopStepOffers()).not.toThrow()
  })
})

describe('problemOf', () => {
  const refused = (status: number, code?: string) =>
    new Response(code ? JSON.stringify({ code, message: code }) : 'nope', { status })

  it.each([
    [400, 'INVALID_EMAIL', 'invalidEmail'],
    [400, 'INVALID_OTP', 'wrongCode'],
    [400, 'OTP_EXPIRED', 'codeExpired'],
    [403, 'TOO_MANY_ATTEMPTS', 'codeExpired'],
    [429, undefined, 'tooManyTries'],
    [503, 'OTP_DELIVERY_UNAVAILABLE', 'unavailable'],
    [500, undefined, 'failed'],
    [400, 'SOMETHING_NEW', 'failed']
  ])('reads %i %s as %s', async (status, code, problem) => {
    expect(await problemOf(refused(status, code))).toBe(problem)
  })
})

describe('readSession', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage())
  })

  const answer = (response: Response | Error) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (response instanceof Error) throw response
        return response
      })
    )

  it('reads no session as signed out', async () => {
    answer(Response.json(null))
    expect(await readSession()).toEqual({ status: 'signedOut' })
  })

  it('reads a session as signed in, with news on unless the account turned it off', async () => {
    answer(Response.json({ session: {}, user: { id: 'user-a', email: 'a@example.com' } }))
    expect(await readSession()).toEqual({
      status: 'signedIn',
      id: 'user-a',
      email: 'a@example.com',
      marketingEmail: true
    })
    answer(Response.json({ session: {}, user: { email: 'a@example.com', marketingEmail: false } }))
    expect(await readSession()).toMatchObject({ marketingEmail: false })
  })

  // Only a definite "signed out" may clear a guest's farts (visit.ts), so a session that can't
  // be read is never one.
  it('reads a refused or failed request as unreachable, not signed out', async () => {
    answer(new Response('down', { status: 503 }))
    expect(await readSession()).toEqual({ status: 'unreachable' })
    answer(new Response('oops', { status: 500 }))
    expect(await readSession()).toEqual({ status: 'unreachable' })
    answer(new TypeError('offline'))
    expect(await readSession()).toEqual({ status: 'unreachable' })
  })

  // A get-session that never answers (a captive portal, a stalled connection) would hold the
  // visit's library, and every save, forever.
  it('gives up after 5 seconds and reads unreachable', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_, reject) => {
            init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
          })
      )
    )
    let read: unknown = 'pending'
    void readSession().then(account => {
      read = account
    })
    await vi.advanceTimersByTimeAsync(4_999)
    expect(read).toBe('pending')
    await vi.advanceTimersByTimeAsync(1)
    expect(read).toEqual({ status: 'unreachable' })
  })

  // An ended session must not read as a guest's: that would clear the account's farts (visit.ts).
  it("reads signed out as expired where the library is an account's, until it signs out", async () => {
    setLibraryOwner('user-a')
    answer(Response.json(null))
    expect(await readSession()).toEqual({ status: 'expired' })
    forgetAccount()
    answer(Response.json(null))
    expect(await readSession()).toEqual({ status: 'signedOut' })
  })

  it('reads signed out as a guest when localStorage is blocked', async () => {
    vi.stubGlobal('localStorage', blockedStorage())
    answer(Response.json(null))
    expect(await readSession()).toEqual({ status: 'signedOut' })
  })

  // Remembering the account is best effort: a browser that can't store it is still signed in.
  it('reads a session as signed in when localStorage is blocked', async () => {
    vi.stubGlobal('localStorage', blockedStorage())
    answer(Response.json({ session: {}, user: { email: 'a@example.com' } }))
    expect(await readSession()).toMatchObject({ status: 'signedIn', email: 'a@example.com' })
  })
})

describe('signIn', () => {
  // A sign-in never names whose this browser's library is: `claimLibrary` does, once it has
  // checked it isn't another account's. A sign-in that wrote it would hand that one over.
  it("signs in as the account's id, and leaves this browser's library unclaimed", async () => {
    vi.stubGlobal('localStorage', memoryStorage())
    setLibraryOwner('user-b')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ user: { id: 'user-a', email: 'a@example.com' } }))
    )
    expect(await signIn('a@example.com', '123456')).toMatchObject({
      ok: true,
      value: { status: 'signedIn', id: 'user-a' }
    })
    expect(libraryOwner()).toBe('user-b')
  })

  // The code was right and the cookie is set, so a blocked localStorage isn't "Couldn't reach Pedos".
  it('signs in when localStorage is blocked', async () => {
    vi.stubGlobal('localStorage', blockedStorage())
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ user: { email: 'a@example.com' } }))
    )
    expect(await signIn('a@example.com', '123456')).toMatchObject({
      ok: true,
      value: { status: 'signedIn', email: 'a@example.com' }
    })
  })
})

describe('the step draft', () => {
  it('keeps the phase and email for this tab until the step closes', () => {
    vi.stubGlobal('sessionStorage', memoryStorage())
    expect(readStepDraft()).toBeNull()
    saveStepDraft({ phase: 'code', email: 'a@example.com' })
    expect(readStepDraft()).toEqual({ phase: 'code', email: 'a@example.com' })
    clearStepDraft()
    expect(readStepDraft()).toBeNull()
  })

  it('keeps nothing with storage blocked', () => {
    vi.stubGlobal('sessionStorage', blockedStorage())
    saveStepDraft({ phase: 'code', email: 'a@example.com' })
    expect(readStepDraft()).toBeNull()
  })
})

describe('takeSignInAgain', () => {
  it('asks once a visit, and never with storage blocked', () => {
    vi.stubGlobal('sessionStorage', memoryStorage())
    expect(takeSignInAgain()).toBe(true)
    expect(takeSignInAgain()).toBe(false)
    vi.stubGlobal('sessionStorage', blockedStorage())
    expect(takeSignInAgain()).toBe(false)
  })
})
