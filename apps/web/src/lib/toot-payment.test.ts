import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  paidReturnPath,
  readCheckoutReturn,
  startCheckout,
  tootPaid,
  waitUntilPaid
} from './toot-payment'

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
  it('asks for the Toot’s checkout as the account’s library', async () => {
    const fetch = answering(Response.json({ url: 'https://checkout.stripe.com/c/pay/cs_test_a' }))
    expect(await startCheckout(TOOT, 'twinkle', 'userA')).toEqual({
      kind: 'pay',
      url: 'https://checkout.stripe.com/c/pay/cs_test_a'
    })
    const [path, init] = fetch.mock.calls[0]
    expect(path).toBe(`/api/toots/${TOOT}/checkout/`)
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('x-pedos-library')).toBe('userA')
    expect(JSON.parse(String(init?.body))).toEqual({ songId: 'twinkle' })
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

  it('has nothing to pay for a paid Toot', async () => {
    answering(Response.json({ paid: true }))
    expect(await startCheckout(TOOT, 'twinkle', 'userA')).toEqual({ kind: 'paid' })
  })

  it('names another Toot of the Song that is paid for and was never saved', async () => {
    const other = '44444444-4444-4444-8444-444444444444'
    answering(Response.json({ paidToot: other }))
    expect(await startCheckout(TOOT, 'twinkle', 'userA')).toEqual({
      kind: 'paidToot',
      tootId: other
    })
    vi.restoreAllMocks()
    for (const paidToot of ['../profile', `${other}x`, 42]) {
      answering(Response.json({ paidToot }))
      expect(await startCheckout(TOOT, 'twinkle', 'userA')).toEqual({
        kind: 'failed',
        problem: 'failed'
      })
      vi.restoreAllMocks()
    }
  })

  it('says why it failed', async () => {
    const cases: [Response | Error, string][] = [
      [Response.json({ error: 'payments_unavailable' }, { status: 503 }), 'unavailable'],
      [Response.json({ error: 'limit_reached' }, { status: 409 }), 'limitReached'],
      [Response.json({ error: 'rate_limited' }, { status: 429 }), 'tooMany'],
      [Response.json({ error: 'wrong_library' }, { status: 409 }), 'failed'],
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

describe('tootPaid', () => {
  it('is the server’s answer, or null when it couldn’t say', async () => {
    answering(Response.json({ paid: true }))
    expect(await tootPaid(TOOT, 'userA')).toBe(true)
    vi.restoreAllMocks()
    answering(Response.json({ paid: false }))
    expect(await tootPaid(TOOT, 'userA')).toBe(false)
    vi.restoreAllMocks()
    answering(Response.json({ error: 'signed_out' }, { status: 401 }))
    expect(await tootPaid(TOOT, 'userA')).toBeNull()
  })
})

describe('waitUntilPaid', () => {
  it('asks again until the payment comes through', async () => {
    const answers = [{ paid: false }, { error: 'payments_failed' }, { paid: true }]
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const body = answers.shift()
      return Response.json(body, { status: body && 'error' in body ? 502 : 200 })
    })
    expect(await waitUntilPaid(TOOT, 'userA', { tries: 5, intervalMs: 1 })).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('gives up after its tries', async () => {
    const fetch = answering(Response.json({ paid: false }))
    expect(await waitUntilPaid(TOOT, 'userA', { tries: 3, intervalMs: 1 })).toBe(false)
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

describe('paidReturnPath', () => {
  it('is the Song Creator address a paid Checkout comes back to', () => {
    const path = paidReturnPath('twinkle', TOOT)
    expect(path).toBe(`/compose/twinkle/?toot=${TOOT}&checkout=done`)
    expect(readCheckoutReturn(new URL(path, 'https://farty.fm').search)).toEqual({
      tootId: TOOT,
      done: true
    })
  })
})
