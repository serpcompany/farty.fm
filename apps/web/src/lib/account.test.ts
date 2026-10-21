import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  problemOf,
  readSession,
  type StepOffers,
  stepOffer,
  stopStepOffers,
  takeStepOffer
} from './account'

afterEach(() => {
  vi.unstubAllGlobals()
})

function memoryStorage(): Storage {
  const items = new Map<string, string>()
  return {
    get length() {
      return items.size
    },
    clear: () => items.clear(),
    getItem: key => items.get(key) ?? null,
    key: index => [...items.keys()][index] ?? null,
    removeItem: key => {
      items.delete(key)
    },
    setItem: (key, value) => {
      items.set(key, value)
    }
  }
}

function blockedStorage(): Storage {
  const blocked = () => {
    throw new DOMException('blocked', 'SecurityError')
  }
  return { ...memoryStorage(), getItem: blocked, setItem: blocked }
}

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
    answer(Response.json({ session: {}, user: { email: 'a@example.com' } }))
    expect(await readSession()).toEqual({
      status: 'signedIn',
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
})
