import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  canSaveFromStored,
  hasStoredFullAccess,
  readCheckoutReturn,
  saveCheck,
  startCheckout,
  startOfferCheckout,
  waitForFullAccess
} from './full-access'

const TOOT = '33333333-3333-4333-8333-333333333333'

beforeEach(() => {
  vi.stubGlobal('window', { location: { origin: 'https://staging.farty.fm', search: '' } })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const answering = (response: Response | Error) =>
  vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () =>
      response instanceof Error ? Promise.reject(response) : response.clone()
    )

describe('startCheckout', () => {
  it('asks for Full Access’s checkout as the account’s library, naming the Toot to come back to', async () => {
    const fetch = answering(Response.json({ url: 'https://checkout.stripe.com/c/pay/cs_test_a' }))
    expect(await startCheckout(TOOT, 'twinkle', 'userA')).toEqual({
      kind: 'pay',
      url: 'https://checkout.stripe.com/c/pay/cs_test_a'
    })
    const [path, init] = fetch.mock.calls[0]
    expect(path).toBe('/api/full-access/checkout/')
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('x-pedos-library')).toBe('userA')
    expect(JSON.parse(String(init?.body))).toEqual({ tootId: TOOT, songId: 'twinkle' })
  })

  it('goes to the dev checkout on this site', async () => {
    const url = `https://staging.farty.fm/dev/checkout/?toot=${TOOT}&song=twinkle`
    answering(Response.json({ url }))
    expect(await startCheckout(TOOT, 'twinkle', 'userA')).toEqual({ kind: 'pay', url })
  })

  it('goes nowhere but Stripe’s page or this site’s dev checkout', async () => {
    for (const url of [
      'https://evil.example/pay',
      'https://checkout.stripe.com.evil.example/pay',
      'https://staging.farty.fm/profile/',
      'javascript:alert(1)',
      'not a url'
    ]) {
      answering(Response.json({ url }))
      expect(await startCheckout(TOOT, 'twinkle', 'userA')).toEqual({
        kind: 'failed',
        problem: 'failed'
      })
      vi.restoreAllMocks()
    }
  })

  it('has nothing to pay on an account with Full Access', async () => {
    answering(Response.json({ active: true }))
    expect(await startCheckout(TOOT, 'twinkle', 'userA')).toEqual({ kind: 'active' })
  })

  it('says why it failed', async () => {
    const cases: [Response | Error, string][] = [
      [Response.json({ error: 'payments_unavailable' }, { status: 503 }), 'unavailable'],
      [Response.json({ error: 'limit_reached' }, { status: 409 }), 'limitReached'],
      [Response.json({ error: 'payment_mismatch' }, { status: 409 }), 'charged'],
      [Response.json({ error: 'rate_limited' }, { status: 429 }), 'tooMany'],
      [Response.json({ error: 'wrong_library' }, { status: 409 }), 'failed'],
      [Response.json({ error: 'deleted' }, { status: 410 }), 'failed'],
      [Response.json({ error: 'payments_failed' }, { status: 502 }), 'failed'],
      [new TypeError('offline'), 'failed']
    ]
    for (const [response, problem] of cases) {
      answering(response)
      expect(await startCheckout(TOOT, 'twinkle', 'userA')).toEqual({ kind: 'failed', problem })
      vi.restoreAllMocks()
    }
  })
})

describe('saveCheck', () => {
  it('is what Save does on this account, and null when Farty couldn’t say', async () => {
    const cases: [Response | Error, Awaited<ReturnType<typeof saveCheck>>][] = [
      [Response.json({ active: true, limitReached: false }), 'save'],
      [Response.json({ active: true, limitReached: true }), 'limitReached'],
      [Response.json({ active: false, limitReached: false }), 'offer'],
      [Response.json({ error: 'signed_out' }, { status: 401 }), null],
      [Response.json({}), null],
      [new TypeError('offline'), null]
    ]
    for (const [response, then] of cases) {
      const fetch = answering(response)
      expect(await saveCheck('userA')).toBe(then)
      const [path, init] = fetch.mock.calls[0]
      expect(path).toBe('/api/full-access/')
      expect(new Headers(init?.headers).get('x-pedos-library')).toBe('userA')
      vi.restoreAllMocks()
    }
  })
})

describe('canSaveFromStored', () => {
  it('asks what D1 has, so the Sound Pad’s open never spends the Stripe checks a return waits on', async () => {
    const cases: [Response, boolean | null][] = [
      [Response.json({ active: true, limitReached: false }), true],
      [Response.json({ active: true, limitReached: true }), false],
      [Response.json({ active: false, limitReached: false }), false],
      [Response.json({ error: 'signed_out' }, { status: 401 }), null]
    ]
    for (const [response, then] of cases) {
      const fetch = answering(response)
      expect(await canSaveFromStored('userA')).toBe(then)
      expect(fetch.mock.calls[0][0]).toBe('/api/full-access/?check=stored')
      vi.restoreAllMocks()
    }
  })
})

describe('waitForFullAccess', () => {
  it('asks again until the payment comes through', async () => {
    const answers = [{ active: false }, { error: 'payments_failed' }, { active: true }]
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const body = answers.shift()
      return Response.json(body, { status: body && 'error' in body ? 502 : 200 })
    })
    expect(await waitForFullAccess('userA', { tries: 5, intervalMs: 1 })).toBe('save')
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('says when the account has Full Access but no room for the Toot', async () => {
    answering(Response.json({ active: true, limitReached: true }))
    expect(await waitForFullAccess('userA', { tries: 3, intervalMs: 1 })).toBe('limitReached')
  })

  it('gives up after its tries', async () => {
    const fetch = answering(Response.json({ active: false }))
    expect(await waitForFullAccess('userA', { tries: 3, intervalMs: 1 })).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(3)
  })
})

describe('readCheckoutReturn', () => {
  it('reads the Toot and whether it was paid', () => {
    expect(readCheckoutReturn(`?toot=${TOOT}&checkout=done`)).toEqual({
      tootId: TOOT,
      done: true
    })
    expect(readCheckoutReturn(`?toot=${TOOT}`)).toEqual({ tootId: TOOT, done: false })
  })

  it('is null for any other address', () => {
    for (const search of ['', '?checkout=done', '?toot=abc&checkout=done', `?toot=${TOOT}x`]) {
      expect(readCheckoutReturn(search)).toBeNull()
    }
  })
})

describe('startOfferCheckout', () => {
  it('asks for a checkout that names the offer, and no Toot', async () => {
    const fetch = answering(Response.json({ url: 'https://checkout.stripe.com/c/pay/cs_test_a' }))
    expect(await startOfferCheckout('welcome', 'userA')).toEqual({
      kind: 'pay',
      url: 'https://checkout.stripe.com/c/pay/cs_test_a'
    })
    const [path, init] = fetch.mock.calls[0]
    expect(path).toBe('/api/full-access/checkout/')
    expect(new Headers(init?.headers).get('x-pedos-library')).toBe('userA')
    expect(JSON.parse(String(init?.body))).toEqual({ offer: 'welcome' })
  })
})

describe('hasStoredFullAccess', () => {
  it('asks from what’s stored', async () => {
    const fetch = answering(Response.json({ active: true, limitReached: true }))
    expect(await hasStoredFullAccess('userA')).toBe(true)
    expect(fetch.mock.calls[0][0]).toBe('/api/full-access/?check=stored')
  })

  it('says no when the account hasn’t it, and null when Farty couldn’t say', async () => {
    answering(Response.json({ active: false, limitReached: false }))
    expect(await hasStoredFullAccess('userA')).toBe(false)
    vi.restoreAllMocks()
    answering(Response.json({ error: 'nope' }, { status: 500 }))
    expect(await hasStoredFullAccess('userA')).toBeNull()
  })

  it('never holds up a tap for longer than it’s given', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}))
    expect(await hasStoredFullAccess('userA', 5)).toBeNull()
  })
})
