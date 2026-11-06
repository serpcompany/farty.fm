import { afterEach, describe, expect, it, vi } from 'vitest'

import { FULL_ACCESS_PRICE, savingIsPaid } from '@/lib/pricing'

import {
  type CheckoutSession,
  createCheckoutSession,
  isCheckoutSessionId,
  paidForFullAccess,
  paidForToot,
  paymentsConfig,
  retrieveCheckoutSession,
  SIGNATURE_TOLERANCE_SECONDS,
  STRIPE_API_VERSION,
  StripeError,
  verifyStripeSignature
} from './stripe'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

// Made-up values in Stripe's formats, never real keys.
const TEST_KEY = 'sk_test_madeUpForTheTests'
const LIVE_KEY = 'sk_live_madeUpForTheTests'
const WEBHOOK_SECRET = 'whsec_madeUpForTheTests'
const TOOT = '33333333-3333-4333-8333-333333333333'

describe('paymentsConfig', () => {
  it('stands in for Checkout on a local run on a local host with no key', () => {
    expect(paymentsConfig({}, 'localhost:3000')).toEqual({ kind: 'dev' })
    expect(paymentsConfig({}, '127.0.0.1:8787')).toEqual({ kind: 'dev' })
  })

  it('takes no payment on a local run reached from another host', () => {
    expect(paymentsConfig({}, 'farty.example')).toEqual({ kind: 'off' })
    expect(paymentsConfig({}, '192.168.1.20:3000')).toEqual({ kind: 'off' })
    expect(paymentsConfig({}, null)).toEqual({ kind: 'off' })
  })

  describe('on Production, where saving is paid (#258)', () => {
    const production = (key: unknown) =>
      paymentsConfig({ SITE_ENV: 'production', STRIPE_SECRET_KEY: key }, 'farty.fm')

    it('takes only a live key, in live mode', () => {
      expect(savingIsPaid('production')).toBe(true)
      expect(production(LIVE_KEY)).toEqual({
        kind: 'stripe',
        secretKey: LIVE_KEY,
        webhookSecret: null,
        livemode: true
      })
      expect(production('rk_live_madeUpForTheTests')).toMatchObject({
        kind: 'stripe',
        livemode: true
      })
      expect(
        paymentsConfig(
          {
            SITE_ENV: 'production',
            STRIPE_SECRET_KEY: LIVE_KEY,
            STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET
          },
          'farty.fm'
        )
      ).toMatchObject({ kind: 'stripe', webhookSecret: WEBHOOK_SECRET, livemode: true })
    })

    it('turns payments off with a test key or none, and never stands in for Checkout', () => {
      for (const key of [TEST_KEY, 'rk_test_madeUp', undefined, '']) {
        expect(production(key)).toEqual({ kind: 'off' })
      }
      expect(paymentsConfig({ SITE_ENV: 'production' }, 'localhost:8787')).toEqual({
        kind: 'off'
      })
    })
  })

  it('pays on a local run of a Production build, as its Save does, never with a live key', () => {
    vi.stubEnv('PEDOS_ENVIRONMENT', 'production')
    expect(paymentsConfig({}, 'localhost:4158')).toEqual({ kind: 'dev' })
    expect(paymentsConfig({ STRIPE_SECRET_KEY: TEST_KEY }, 'localhost:4158')).toEqual({
      kind: 'stripe',
      secretKey: TEST_KEY,
      webhookSecret: null,
      livemode: false
    })
    expect(paymentsConfig({ STRIPE_SECRET_KEY: LIVE_KEY }, 'localhost:4158')).toEqual({
      kind: 'off'
    })
    vi.stubEnv('PEDOS_ENVIRONMENT', 'staging')
    expect(paymentsConfig({}, 'localhost:3071')).toEqual({ kind: 'dev' })
  })

  it('saves free where `savingIsPaid` says so, so free saving comes back from pricing.ts alone', () => {
    const free = vi.fn(() => false)
    for (const key of [undefined, LIVE_KEY, TEST_KEY]) {
      expect(
        paymentsConfig({ SITE_ENV: 'production', STRIPE_SECRET_KEY: key }, 'farty.fm', free)
      ).toEqual({ kind: 'free' })
    }
    expect(free).toHaveBeenLastCalledWith('production')
    // A local run asks about the environment its build is for, as its Save does.
    vi.stubEnv('PEDOS_ENVIRONMENT', 'production')
    expect(paymentsConfig({}, 'localhost:3071', free)).toEqual({ kind: 'free' })
    expect(free).toHaveBeenLastCalledWith('production')
  })

  it('uses Stripe in test mode on Staging, with the webhook secret once it is set', () => {
    const staging = { SITE_ENV: 'staging', STRIPE_SECRET_KEY: TEST_KEY }
    expect(paymentsConfig(staging, 'staging.farty.fm')).toEqual({
      kind: 'stripe',
      secretKey: TEST_KEY,
      webhookSecret: null,
      livemode: false
    })
    expect(
      paymentsConfig({ ...staging, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET }, 'staging.farty.fm')
    ).toEqual({
      kind: 'stripe',
      secretKey: TEST_KEY,
      webhookSecret: WEBHOOK_SECRET,
      livemode: false
    })
    expect(
      paymentsConfig({ ...staging, STRIPE_WEBHOOK_SECRET: 'not-a-secret' }, 'staging.farty.fm')
    ).toMatchObject({ kind: 'stripe', webhookSecret: null })
  })

  it('takes a restricted test key too', () => {
    const key = 'rk_test_madeUpForTheTests'
    expect(paymentsConfig({ SITE_ENV: 'staging', STRIPE_SECRET_KEY: key }, null)).toMatchObject({
      kind: 'stripe',
      secretKey: key
    })
  })

  it('turns payments off with no key, a live key or a misconfigured environment', () => {
    expect(paymentsConfig({ SITE_ENV: 'staging' }, 'staging.farty.fm')).toEqual({ kind: 'off' })
    expect(paymentsConfig({ SITE_ENV: 'staging' }, 'localhost:8787')).toEqual({ kind: 'off' })
    for (const key of ['sk_live_madeUp', 'rk_live_madeUp', '', 42]) {
      expect(paymentsConfig({ SITE_ENV: 'staging', STRIPE_SECRET_KEY: key }, null)).toEqual({
        kind: 'off'
      })
      expect(paymentsConfig({ STRIPE_SECRET_KEY: key }, 'localhost:3000')).toEqual({ kind: 'off' })
    }
    expect(paymentsConfig({ SITE_ENV: 'prod', STRIPE_SECRET_KEY: TEST_KEY }, null)).toEqual({
      kind: 'off'
    })
  })

  it('uses Stripe in test mode on a local run that has a test key', () => {
    expect(paymentsConfig({ STRIPE_SECRET_KEY: TEST_KEY }, 'localhost:3000')).toMatchObject({
      kind: 'stripe',
      livemode: false
    })
  })
})

describe('isCheckoutSessionId', () => {
  it('takes only a Checkout Session id', () => {
    expect(isCheckoutSessionId('cs_test_a1B2c3')).toBe(true)
    expect(isCheckoutSessionId('cs_live_a1B2c3')).toBe(true)
    for (const id of ['dev_123', 'cs_test_', 'cs_test_../x', 'pi_test_abc', '']) {
      expect(isCheckoutSessionId(id)).toBe(false)
    }
  })
})

const session = (fields: Partial<CheckoutSession> = {}): CheckoutSession => ({
  id: 'cs_test_a1',
  url: 'https://checkout.stripe.com/c/pay/cs_test_a1',
  mode: 'payment',
  status: 'complete',
  payment_status: 'paid',
  client_reference_id: 'userA',
  metadata: { purchase: 'full_access', user_id: 'userA', toot_id: TOOT },
  livemode: false,
  amount_total: 499,
  currency: 'usd',
  ...fields
})

describe('paidForFullAccess', () => {
  const paid = (fields: Partial<CheckoutSession> = {}, userId = 'userA') =>
    paidForFullAccess(session(fields), userId, FULL_ACCESS_PRICE)

  it('is true for a paid session for this user', () => {
    expect(paid()).toBe(true)
  })

  it('is false for an unpaid session, or one for another user or purchase', () => {
    expect(paid({ payment_status: 'unpaid' })).toBe(false)
    expect(paid({ payment_status: 'no_payment_required' })).toBe(false)
    expect(paid({ mode: 'subscription' })).toBe(false)
    expect(paid({}, 'userB')).toBe(false)
    expect(paid({ client_reference_id: 'userB' })).toBe(false)
    expect(paid({ metadata: null })).toBe(false)
    expect(paid({ metadata: { user_id: 'userA', toot_id: TOOT } })).toBe(false)
  })

  it('is false for a session that charged anything but the price', () => {
    expect(paid({ amount_total: 1 })).toBe(false)
    expect(paid({ amount_total: 0 })).toBe(false)
    expect(paid({ amount_total: null })).toBe(false)
    expect(paid({ currency: 'eur' })).toBe(false)
    expect(paid({ currency: null })).toBe(false)
  })

  it('is true with Adaptive Pricing: the session keeps 499 usd, the buyer paid in their currency', () => {
    expect(
      paid({ presentment_details: { presentment_currency: 'jpy', presentment_amount: 820 } })
    ).toBe(true)
  })

  it('judges by the price its checkout started at, not today’s', () => {
    const before = { amount: 299, currency: 'usd' }
    const paidThen = session({ amount_total: 299 })
    expect(paidForFullAccess(paidThen, 'userA', before)).toBe(true)
    expect(paidForFullAccess(paidThen, 'userA', FULL_ACCESS_PRICE)).toBe(false)
    expect(paidForFullAccess(session(), 'userA', before)).toBe(false)
  })
})

describe('paidForToot', () => {
  const PRICE = { amount: 99, currency: 'usd' }
  const old = (fields: Partial<CheckoutSession> = {}) =>
    session({
      client_reference_id: TOOT,
      metadata: { user_id: 'userA', toot_id: TOOT },
      amount_total: 99,
      ...fields
    })

  it('is true for a paid session from before Full Access, for this user and Toot', () => {
    expect(paidForToot(old(), 'userA', TOOT, PRICE)).toBe(true)
  })

  it('is false for an unpaid session, one for another user or Toot, or another price', () => {
    const other = '44444444-4444-4444-8444-444444444444'
    expect(paidForToot(old({ payment_status: 'unpaid' }), 'userA', TOOT, PRICE)).toBe(false)
    expect(paidForToot(old(), 'userB', TOOT, PRICE)).toBe(false)
    expect(paidForToot(old(), 'userA', other, PRICE)).toBe(false)
    expect(paidForToot(old({ client_reference_id: other }), 'userA', TOOT, PRICE)).toBe(false)
    expect(paidForToot(old({ amount_total: 499 }), 'userA', TOOT, PRICE)).toBe(false)
  })
})

describe('createCheckoutSession', () => {
  it('asks Stripe for a $4.99 payment for Full Access, named by its user, coming back to the Toot', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json(session({ status: 'open', payment_status: 'unpaid' })))
    const created = await createCheckoutSession(TEST_KEY, {
      userId: 'userA',
      email: 'a@example.test',
      tootId: TOOT,
      successUrl: `https://staging.farty.fm/compose/twinkle/?toot=${TOOT}&checkout=done`,
      cancelUrl: `https://staging.farty.fm/compose/twinkle/?toot=${TOOT}`,
      replaces: null
    })
    expect(created.id).toBe('cs_test_a1')
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions')
    expect(init?.method).toBe('POST')
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${TEST_KEY}`)
    expect(headers.get('stripe-version')).toBe(STRIPE_API_VERSION)
    expect(headers.get('idempotency-key')).toBe(`full-access/userA/${TOOT}/first`)
    expect(Object.fromEntries(init?.body as URLSearchParams)).toEqual({
      mode: 'payment',
      'payment_method_types[0]': 'card',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': '499',
      'line_items[0][price_data][product_data][name]': 'Farty Full Access',
      client_reference_id: 'userA',
      customer_email: 'a@example.test',
      'metadata[purchase]': 'full_access',
      'metadata[user_id]': 'userA',
      'metadata[toot_id]': TOOT,
      'payment_intent_data[metadata][purchase]': 'full_access',
      'payment_intent_data[metadata][user_id]': 'userA',
      success_url: `https://staging.farty.fm/compose/twinkle/?toot=${TOOT}&checkout=done`,
      cancel_url: `https://staging.farty.fm/compose/twinkle/?toot=${TOOT}`
    })
  })

  it('names an offer instead of a Toot, and goes back to its place (#407)', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json(session({ status: 'open', payment_status: 'unpaid' })))
    await createCheckoutSession(TEST_KEY, {
      userId: 'userA',
      email: 'a@example.test',
      offer: 'welcome',
      successUrl: 'https://staging.farty.fm/?offer=welcome&checkout=done',
      cancelUrl: 'https://staging.farty.fm/?offer=welcome',
      replaces: 'cs_test_last'
    })
    const [, init] = fetch.mock.calls[0]
    expect(new Headers(init?.headers).get('idempotency-key')).toBe(
      'full-access/userA/offer-welcome/cs_test_last'
    )
    const sent = init?.body as URLSearchParams
    expect(sent.get('metadata[offer]')).toBe('welcome')
    expect(sent.has('metadata[toot_id]')).toBe(false)
  })

  it('fails with Stripe’s status alone, never its answer', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        { error: { message: `Invalid API Key provided: ${TEST_KEY}` } },
        { status: 401 }
      )
    )
    const failed = await createCheckoutSession(TEST_KEY, {
      userId: 'userA',
      email: 'a@example.test',
      tootId: TOOT,
      successUrl: 'https://staging.farty.fm/',
      cancelUrl: 'https://staging.farty.fm/',
      replaces: null
    }).catch((error: unknown) => error)
    expect(failed).toBeInstanceOf(StripeError)
    expect((failed as StripeError).status).toBe(401)
    expect(String(failed)).not.toContain(TEST_KEY)
  })

  it('names the session it replaces in its idempotency key, so only a retry gets the same one', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => Response.json(session({ status: 'open' })))
    const checkout = {
      userId: 'userA',
      email: 'a@example.test',
      tootId: TOOT,
      successUrl: 'https://staging.farty.fm/',
      cancelUrl: 'https://staging.farty.fm/'
    }
    await createCheckoutSession(TEST_KEY, { ...checkout, replaces: null })
    await createCheckoutSession(TEST_KEY, { ...checkout, replaces: 'cs_test_expired1' })
    const keys = fetch.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get('idempotency-key')
    )
    expect(keys).toEqual([
      `full-access/userA/${TOOT}/first`,
      `full-access/userA/${TOOT}/cs_test_expired1`
    ])
  })

  it('reads a session with the pinned API version and no idempotency key', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(session()))
    await retrieveCheckoutSession(TEST_KEY, 'cs_test_a1')
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions/cs_test_a1')
    const headers = new Headers(init?.headers)
    expect(headers.get('stripe-version')).toBe(STRIPE_API_VERSION)
    expect(headers.has('idempotency-key')).toBe(false)
  })

  it('fails with status 0 when Stripe can’t be reached', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network'))
    await expect(retrieveCheckoutSession(TEST_KEY, 'cs_test_a1')).rejects.toMatchObject({
      status: 0
    })
  })

  it('never puts anything but a session id in the path', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    await expect(retrieveCheckoutSession(TEST_KEY, '../customers')).rejects.toBeInstanceOf(
      StripeError
    )
    expect(fetch).not.toHaveBeenCalled()
  })
})

const encoder = new TextEncoder()

/** `Stripe-Signature`'s v1, as Stripe makes it. */
async function sign(payload: string, timestamp: number, secret = WEBHOOK_SECRET) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${payload}`))
  return Buffer.from(mac).toString('hex')
}

describe('verifyStripeSignature', () => {
  const payload = JSON.stringify({ type: 'checkout.session.completed' })
  const now = 1_790_000_000
  const verify = (header: string | null, body = payload, at = now) =>
    verifyStripeSignature(encoder.encode(body), header, WEBHOOK_SECRET, at)

  it('takes a body signed with the endpoint’s secret', async () => {
    expect(await verify(`t=${now},v1=${await sign(payload, now)}`)).toBe(true)
  })

  it('takes any v1, as while a secret is rolled', async () => {
    const other = await sign(payload, now, 'whsec_theOldOne')
    const right = await sign(payload, now)
    expect(await verify(`t=${now},v1=${other},v1=${right},v0=abc`)).toBe(true)
  })

  it('refuses a forged signature or a changed body', async () => {
    expect(await verify(`t=${now},v1=${await sign(payload, now, 'whsec_forged')}`)).toBe(false)
    const signed = `t=${now},v1=${await sign(payload, now)}`
    expect(await verify(signed, payload.replace('completed', 'expired'))).toBe(false)
    expect(await verify(`t=${now + 1},v1=${await sign(payload, now)}`)).toBe(false)
  })

  it('refuses a stale or future timestamp, so a captured event can’t be replayed', async () => {
    const old = now - SIGNATURE_TOLERANCE_SECONDS - 1
    expect(await verify(`t=${old},v1=${await sign(payload, old)}`)).toBe(false)
    const ahead = now + SIGNATURE_TOLERANCE_SECONDS + 1
    expect(await verify(`t=${ahead},v1=${await sign(payload, ahead)}`)).toBe(false)
    const edge = now - SIGNATURE_TOLERANCE_SECONDS
    expect(await verify(`t=${edge},v1=${await sign(payload, edge)}`)).toBe(true)
  })

  it('refuses more v1 than Stripe sends, even with the right one among them', async () => {
    const wrong = await sign(payload, now, 'whsec_forged')
    const right = await sign(payload, now)
    const many = [wrong, wrong, wrong, wrong, right].map(v1 => `v1=${v1}`).join(',')
    expect(await verify(`t=${now},${many}`)).toBe(false)
  })

  it('refuses a missing or malformed header', async () => {
    const v1 = await sign(payload, now)
    for (const header of [null, '', `v1=${v1}`, `t=${now}`, `t=abc,v1=${v1}`, `t=${now},v1=zz`]) {
      expect(await verify(header)).toBe(false)
    }
  })
})
