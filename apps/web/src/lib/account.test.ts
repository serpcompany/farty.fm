import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SIGN_IN_CODE_MINUTES } from '@/server/email'
import {
  CODE_WORKS_MS,
  clearStepDraft,
  codeSentLately,
  deleteAccount,
  forgetAccount,
  libraryOwner,
  problemOf,
  readSession,
  offerStepAgain,
  readStepDraft,
  saveStepDraft,
  setLibraryOwner,
  sendCode,
  setMarketingEmail,
  signIn,
  stopStepOffers,
  takeSignInAgain,
  takeStepOffer
} from './account'
import { blockedStorage, memoryStorage } from './test-storage'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('takeStepOffer', () => {
  it('offers at the first Result only, remembering it in localStorage', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    expect(takeStepOffer()).toBe(true)
    expect(localStorage.getItem('pedos.accountStep')).toBe('once')
    expect(takeStepOffer()).toBe(false)
  })

  it('never offers after signing in, or where it was offered twice before #237', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    stopStepOffers()
    expect(takeStepOffer()).toBe(false)
    localStorage.setItem('pedos.accountStep', 'done')
    expect(takeStepOffer()).toBe(false)
  })

  it('never offers with storage blocked, since it could not remember', () => {
    vi.stubGlobal('localStorage', blockedStorage())
    expect(takeStepOffer()).toBe(false)
    expect(() => stopStepOffers()).not.toThrow()
  })
})

describe('offerStepAgain', () => {
  it('offers the step once more, at the next Result', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    expect(takeStepOffer()).toBe(true)
    offerStepAgain()
    expect(takeStepOffer()).toBe(true)
    expect(takeStepOffer()).toBe(false)
  })

  it('does nothing with storage blocked', () => {
    vi.stubGlobal('localStorage', blockedStorage())
    expect(() => offerStepAgain()).not.toThrow()
  })
})

describe('sendCode', () => {
  const sent = (response: Response) => {
    vi.stubGlobal('localStorage', memoryStorage())
    vi.stubGlobal('fetch', vi.fn(async () => response))
    return sendCode('a@example.com', 'token')
  }

  // While it works, a guest's new visit keeps their farts (`clearsOnOpen`).
  it('remembers a code went out for as long as the code works', async () => {
    expect(CODE_WORKS_MS).toBe(SIGN_IN_CODE_MINUTES * 60_000)
    expect(codeSentLately()).toBe(false)
    expect(await sent(Response.json({ success: true }))).toEqual({ ok: true, value: null })
    const now = Date.now()
    expect(codeSentLately(now)).toBe(true)
    expect(codeSentLately(now + CODE_WORKS_MS - 60_000)).toBe(true)
    expect(codeSentLately(now + CODE_WORKS_MS + 1)).toBe(false)
  })

  it("doesn't when the code wasn't sent", async () => {
    expect(
      await sent(Response.json({ code: 'VERIFICATION_FAILED' }, { status: 403 }))
    ).toMatchObject({ ok: false, problem: 'notChecked' })
    expect(codeSentLately()).toBe(false)
  })

  it('sends with storage blocked, and remembers nothing', async () => {
    vi.stubGlobal('localStorage', blockedStorage())
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true })))
    expect(await sendCode('a@example.com', 'token')).toMatchObject({ ok: true })
    expect(codeSentLately()).toBe(false)
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

  // The code was right and the cookie is set, so a blocked localStorage isn't "Couldn't reach Farty".
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

describe('deleteAccount and setMarketingEmail', () => {
  // A page left open on one account, after another signed in in another tab: the server refuses
  // a change that names the account the page shows (`wrong_account`), so it deletes nothing.
  const changes = [
    ['deleteAccount', () => deleteAccount('user-a')],
    ['setMarketingEmail', () => setMarketingEmail(false, 'user-a')]
  ] as const

  it.each(changes)('%s names the account the page shows', async (_, change) => {
    const fetch = vi.fn(async (_path: string, _init?: RequestInit) => Response.json({}))
    vi.stubGlobal('fetch', fetch)
    expect(await change()).toBe('done')
    const init = fetch.mock.calls[0][1]
    expect(new Headers(init?.headers).get('x-pedos-library')).toBe('user-a')
  })

  it.each(changes)('%s says when the session is another account’s', async (_, change) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'wrong_account' }, { status: 409 }))
    )
    expect(await change()).toBe('otherAccount')
  })

  it.each(changes)('%s fails on any other refusal, or offline', async (_, change) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'x' }, { status: 409 }))
    )
    expect(await change()).toBe('failed')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 500 }))
    )
    expect(await change()).toBe('failed')
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline')))
    )
    expect(await change()).toBe('failed')
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
