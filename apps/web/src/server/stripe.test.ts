import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  type CheckoutSession,
  createCheckoutSession,
  isCheckoutSessionId,
  paidFor,
  paymentsConfig,
  retrieveCheckoutSession,
  SIGNATURE_TOLERANCE_SECONDS,
  StripeError,
  verifyStripeSignature
} from './stripe'

afterEach(() => {
  vi.restoreAllMocks()
})

// Made-up values in Stripe's formats, never real keys.
const TEST_KEY = 'sk_test_madeUpForTheTests'
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

  it('leaves saving free on Production', () => {
    expect(paymentsConfig({ SITE_ENV: 'production' }, 'farty.fm')).toEqual({ kind: 'free' })
    expect(
      paymentsConfig({ SITE_ENV: 'production', STRIPE_SECRET_KEY: TEST_KEY }, 'farty.fm')
    ).toEqual({ kind: 'free' })
  })

  it('uses Stripe in test mode on Staging, with the webhook secret once it is set', () => {
    const staging = { SITE_ENV: 'staging', STRIPE_SECRET_KEY: TEST_KEY }
    expect(paymentsConfig(staging, 'staging.farty.fm')).toEqual({
      kind: 'stripe',
      secretKey: TEST_KEY,
      webhookSecret: null
    })
    expect(
      paymentsConfig({ ...staging, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET }, 'staging.farty.fm')
    ).toEqual({ kind: 'stripe', secretKey: TEST_KEY, webhookSecret: WEBHOOK_SECRET })
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

  it('uses Stripe on a local run that has a test key', () => {
    expect(paymentsConfig({ STRIPE_SECRET_KEY: TEST_KEY }, 'localhost:3000')).toMatchObject({
      kind: 'stripe'
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
  client_reference_id: TOOT,
  metadata: { user_id: 'userA', toot_id: TOOT },
  livemode: false,
  ...fields
})

describe('paidFor', () => {
  it('is true for a paid session for this user and Toot', () => {
    expect(paidFor(session(), 'userA', TOOT)).toBe(true)
  })

  it('is false for an unpaid session, or one for another user or Toot', () => {
    expect(paidFor(session({ payment_status: 'unpaid' }), 'userA', TOOT)).toBe(false)
    expect(paidFor(session({ payment_status: 'no_payment_required' }), 'userA', TOOT)).toBe(false)
    expect(paidFor(session({ mode: 'subscription' }), 'userA', TOOT)).toBe(false)
    expect(paidFor(session(), 'userB', TOOT)).toBe(false)
    const other = '44444444-4444-4444-8444-444444444444'
    expect(paidFor(session(), 'userA', other)).toBe(false)
    expect(paidFor(session({ client_reference_id: other }), 'userA', TOOT)).toBe(false)
    expect(paidFor(session({ metadata: null }), 'userA', TOOT)).toBe(false)
  })
})

describe('createCheckoutSession', () => {
  it('asks Stripe for a $0.99 payment for one Toot, named by its user and id', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json(session({ status: 'open', payment_status: 'unpaid' })))
    const created = await createCheckoutSession(TEST_KEY, {
      userId: 'userA',
      tootId: TOOT,
      songTitle: 'Twinkle Twinkle Little Star',
      successUrl: `https://staging.farty.fm/compose/twinkle/?toot=${TOOT}&checkout=done`,
      cancelUrl: `https://staging.farty.fm/compose/twinkle/?toot=${TOOT}`
    })
    expect(created.id).toBe('cs_test_a1')
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions')
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${TEST_KEY}`)
    expect(Object.fromEntries(init?.body as URLSearchParams)).toEqual({
      mode: 'payment',
      'payment_method_types[0]': 'card',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': '99',
      'line_items[0][price_data][product_data][name]':
        'Save your Toot of Twinkle Twinkle Little Star',
      client_reference_id: TOOT,
      'metadata[user_id]': 'userA',
      'metadata[toot_id]': TOOT,
      'payment_intent_data[metadata][user_id]': 'userA',
      'payment_intent_data[metadata][toot_id]': TOOT,
      success_url: `https://staging.farty.fm/compose/twinkle/?toot=${TOOT}&checkout=done`,
      cancel_url: `https://staging.farty.fm/compose/twinkle/?toot=${TOOT}`
    })
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
      tootId: TOOT,
      songTitle: 'Twinkle',
      successUrl: 'https://staging.farty.fm/',
      cancelUrl: 'https://staging.farty.fm/'
    }).catch((error: unknown) => error)
    expect(failed).toBeInstanceOf(StripeError)
    expect((failed as StripeError).status).toBe(401)
    expect(String(failed)).not.toContain(TEST_KEY)
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
