import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as devCheckoutRoute from '@/app/api/dev/checkout/route'
import * as webhookRoute from '@/app/api/stripe/webhook/route'
import * as checkoutRoute from '@/app/api/toots/[id]/checkout/route'
import * as paymentRoute from '@/app/api/toots/[id]/payment/route'
import { tootPayment } from '@/db/payments'
import type { CheckoutSession } from '@/server/stripe'
import {
  api,
  CF_RAY,
  deletedAgo,
  ORIGIN,
  routeFailureLine,
  seed,
  signUp,
  testDb,
  tootMetadata,
  uploadBody,
  wav
} from '@/test-support/library-api'
import {
  checkoutSession as sessionFor,
  stripeV1,
  TEST_KEY,
  WEBHOOK_SECRET
} from '@/test-support/stripe'

const extraEnv = vi.hoisted(() => ({}) as Record<string, unknown>)
vi.mock('@opennextjs/cloudflare', async () => {
  const { env } = await import('cloudflare:test')
  return { getCloudflareContext: () => ({ env: { ...env, ...extraEnv } }) }
})

const T1 = '33333333-3333-4333-8333-333333333333'
const T2 = '44444444-4444-4444-8444-444444444444'
const HOST = new URL(ORIGIN).host

beforeEach(() => {
  for (const key of Object.keys(extraEnv)) delete extraEnv[key]
})

afterEach(() => {
  vi.restoreAllMocks()
})

type As = { cookie?: string; library?: string; host?: string }

function headersFor(method: string, { cookie, library, host = HOST }: As, extra: HeadersInit = {}) {
  const headers = new Headers(extra)
  headers.set('host', host)
  if (cookie) headers.set('cookie', cookie)
  if (library) headers.set('x-pedos-library', library)
  if (method !== 'GET') headers.set('origin', ORIGIN)
  return headers
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

const checkout = (id: string, as: As, songId: unknown = 'twinkle') =>
  checkoutRoute.POST(
    new Request(`${ORIGIN}/api/toots/${id}/checkout/`, {
      method: 'POST',
      headers: headersFor('POST', as, { 'content-type': 'application/json' }),
      body: JSON.stringify({ songId })
    }),
    params(id)
  )

const payment = (id: string, as: As) =>
  paymentRoute.GET(
    new Request(`${ORIGIN}/api/toots/${id}/payment/`, { headers: headersFor('GET', as) }),
    params(id)
  )

const payDev = (toot: string, as: As, song = 'twinkle') =>
  devCheckoutRoute.POST(
    new Request(`${ORIGIN}/api/dev/checkout/`, {
      method: 'POST',
      headers: headersFor('POST', as, { 'content-type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams({ toot, song })
    }),
    { params: Promise.resolve({}) }
  )

const save = (id: string, as: As) =>
  api.put('toots', id, uploadBody(tootMetadata(id), wav()), as, {
    headers: { host: as.host ?? HOST }
  })

async function paid(id: string, as: As): Promise<boolean> {
  const response = await payment(id, as)
  expect(response.status).toBe(200)
  return ((await response.json()) as { paid: boolean }).paid
}

describe('on a local run, with the dev checkout', () => {
  it('saves a Toot once it is paid for, and not before', async () => {
    const a = await signUp('A')
    expect(await (await save(T1, a)).json()).toEqual({ error: 'payment_required' })
    expect((await save(T1, a)).status).toBe(402)

    const started = await checkout(T1, a)
    expect(started.status).toBe(200)
    expect(started.headers.get('cache-control')).toBe('private, no-store')
    expect(await started.json()).toEqual({
      url: `${ORIGIN}/dev/checkout/?toot=${T1}&song=twinkle`
    })
    expect(await paid(T1, a)).toBe(false)
    expect((await save(T1, a)).status).toBe(402)

    const paying = await payDev(T1, a)
    expect(paying.status).toBe(303)
    expect(paying.headers.get('location')).toBe(
      `${ORIGIN}/compose/twinkle/?toot=${T1}&checkout=done`
    )
    expect(await paid(T1, a)).toBe(true)
    expect((await save(T1, a)).status).toBe(201)
    expect(await (await checkout(T1, a)).json()).toEqual({ paid: true })
  })

  it('pays for one Toot at a time', async () => {
    const a = await signUp('A')
    await checkout(T1, a)
    await payDev(T1, a)
    expect((await save(T1, a)).status).toBe(201)
    expect((await save(T2, a)).status).toBe(402)
    expect(await paid(T2, a)).toBe(false)
  })

  it('never lets one user pay for, or save, another’s Toot', async () => {
    const a = await signUp('A')
    const b = await signUp('B')
    await checkout(T1, a)
    expect((await payDev(T1, b)).status).toBe(404)
    expect(await paid(T1, a)).toBe(false)
    await payDev(T1, a)
    expect(await paid(T1, b)).toBe(false)
    expect((await save(T1, b)).status).toBe(402)
  })

  it('pays only for a checkout it started', async () => {
    const a = await signUp('A')
    expect((await payDev(T1, a)).status).toBe(404)
    expect((await payDev('not-a-toot', a)).status).toBe(400)
    await checkout(T1, a)
    expect((await payDev(T1, a, 'no-such-song')).status).toBe(400)
  })

  it('has no dev checkout off this machine, or with a Stripe key', async () => {
    const a = await signUp('A')
    await checkout(T1, a)
    expect((await payDev(T1, { ...a, host: 'farty.example' })).status).toBe(404)
    expect(await (await checkout(T2, { ...a, host: 'farty.example' })).json()).toEqual({
      error: 'payments_unavailable'
    })
    extraEnv.STRIPE_SECRET_KEY = TEST_KEY
    expect((await payDev(T1, a)).status).toBe(404)
    expect(await paid(T1, a)).toBe(false)
  })

  it('refuses a checkout for a bad id, an unknown Song, or another library', async () => {
    const a = await signUp('A')
    expect((await checkout('not-a-toot', a)).status).toBe(404)
    expect(await (await checkout(T1, a, 'no-such-song')).json()).toEqual({
      error: 'invalid_request'
    })
    expect((await checkout(T1, { ...a, library: 'userB' })).status).toBe(409)
    expect((await checkout(T1, {})).status).toBe(401)
  })

  it('refuses a deleted Toot, and one past the Toot limit, before anything is paid', async () => {
    const a = await signUp('A')
    await deletedAgo('toots', a.id, T1, 0)
    expect(await (await checkout(T1, a)).json()).toEqual({ error: 'deleted' })

    await seed('toots', a.id, 300)
    const full = await checkout(T2, a)
    expect(full.status).toBe(409)
    expect(await full.json()).toEqual({ error: 'limit_reached' })
    expect(await tootPayment(testDb(), a.id, T2)).toBeNull()
  })
})

function stubStripe(...answers: (CheckoutSession | Response)[]) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    const next = answers.shift()
    if (!next) throw new Error('Stripe was asked once too often')
    return next instanceof Response ? next : Response.json(next)
  })
}

async function deliver(
  event: unknown,
  { secret = WEBHOOK_SECRET, timestamp = Math.floor(Date.now() / 1000) } = {}
) {
  const payload = JSON.stringify(event)
  return webhookRoute.POST(
    new Request(`${ORIGIN}/api/stripe/webhook/`, {
      method: 'POST',
      headers: {
        host: 'staging.farty.fm',
        'content-type': 'application/json',
        'stripe-signature': `t=${timestamp},v1=${await stripeV1(payload, timestamp, secret)}`,
        'cf-ray': CF_RAY
      },
      body: payload
    })
  )
}

const completed = (session: CheckoutSession, type = 'checkout.session.completed') => ({
  id: 'evt_test_1',
  object: 'event',
  type,
  livemode: session.livemode,
  data: { object: session }
})

describe('with Stripe Checkout in test mode', () => {
  beforeEach(() => {
    extraEnv.STRIPE_SECRET_KEY = TEST_KEY
    extraEnv.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET
  })

  it('starts a Checkout Session for the Toot, back to its Song Creator', async () => {
    const a = await signUp('A')
    const stripe = stubStripe(sessionFor(a.id, T1))
    expect(await (await checkout(T1, a)).json()).toEqual({
      url: 'https://checkout.stripe.com/c/pay/cs_test_first'
    })
    const [url, init] = stripe.mock.calls[0]
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions')
    const sent = init?.body as URLSearchParams
    expect(sent.get('client_reference_id')).toBe(T1)
    expect(sent.get('metadata[user_id]')).toBe(a.id)
    expect(sent.get('line_items[0][price_data][unit_amount]')).toBe('99')
    expect(sent.get('success_url')).toBe(`${ORIGIN}/compose/twinkle/?toot=${T1}&checkout=done`)
    expect(sent.get('cancel_url')).toBe(`${ORIGIN}/compose/twinkle/?toot=${T1}`)
    expect(await tootPayment(testDb(), a.id, T1)).toMatchObject({
      checkoutSessionId: 'cs_test_first',
      amount: 99,
      currency: 'usd',
      paidAt: null
    })
  })

  it('reuses an open session, so two taps can’t pay twice', async () => {
    const a = await signUp('A')
    const stripe = stubStripe(sessionFor(a.id, T1), sessionFor(a.id, T1))
    await checkout(T1, a)
    expect(await (await checkout(T1, a)).json()).toEqual({
      url: 'https://checkout.stripe.com/c/pay/cs_test_first'
    })
    expect(stripe.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api.stripe.com/v1/checkout/sessions',
      'https://api.stripe.com/v1/checkout/sessions/cs_test_first'
    ])
  })

  const secondSession = (userId: string) =>
    sessionFor(userId, T1, {
      id: 'cs_test_second',
      url: 'https://checkout.stripe.com/c/pay/cs_test_second'
    })

  async function expectSecondSession(a: { id: string; cookie: string }) {
    expect(await (await checkout(T1, a)).json()).toEqual({ url: secondSession(a.id).url })
    expect((await tootPayment(testDb(), a.id, T1))?.checkoutSessionId).toBe('cs_test_second')
  }

  it('starts a new session once the last one expired', async () => {
    const a = await signUp('A')
    const expired = sessionFor(a.id, T1, { status: 'expired', url: null })
    stubStripe(sessionFor(a.id, T1), expired, secondSession(a.id))
    await checkout(T1, a)
    await expectSecondSession(a)
  })

  it('starts a new session when Stripe no longer has the last one', async () => {
    const a = await signUp('A')
    const gone = () => Response.json({ error: { message: 'No such session' } }, { status: 404 })
    stubStripe(sessionFor(a.id, T1), gone(), gone(), secondSession(a.id))
    await checkout(T1, a)
    expect(await paid(T1, a)).toBe(false)
    await expectSecondSession(a)
  })

  it('saves once Stripe says it’s paid, on the return, before the webhook', async () => {
    const a = await signUp('A')
    stubStripe(
      sessionFor(a.id, T1),
      sessionFor(a.id, T1),
      sessionFor(a.id, T1, { status: 'complete', payment_status: 'paid' })
    )
    await checkout(T1, a)
    expect(await paid(T1, a)).toBe(false)
    expect((await save(T1, a)).status).toBe(402)
    expect(await paid(T1, a)).toBe(true)
    expect((await save(T1, a)).status).toBe(201)
  })

  it('answers 502 when Stripe fails, and names nothing of it', async () => {
    const a = await signUp('A')
    stubStripe(Response.json({ error: { message: 'Invalid API Key' } }, { status: 401 }))
    const failed = await checkout(T1, a)
    expect(failed.status).toBe(502)
    expect(await failed.json()).toEqual({ error: 'payments_failed' })
    expect(await tootPayment(testDb(), a.id, T1)).toBeNull()
  })

  it('marks a Toot paid from a signed paid event', async () => {
    const a = await signUp('A')
    stubStripe(sessionFor(a.id, T1))
    await checkout(T1, a)
    vi.restoreAllMocks()
    const stripe = vi.spyOn(globalThis, 'fetch')

    const event = completed(sessionFor(a.id, T1, { status: 'complete', payment_status: 'paid' }))
    const received = await deliver(event)
    expect(received.status).toBe(200)
    expect(received.headers.get('cache-control')).toBe('no-store')
    expect(await paid(T1, a)).toBe(true)
    expect((await save(T1, a)).status).toBe(201)
    expect((await deliver(event)).status).toBe(200)
    expect(stripe).not.toHaveBeenCalled()
  })

  it('takes a slower payment method’s success too', async () => {
    const a = await signUp('A')
    stubStripe(sessionFor(a.id, T1))
    await checkout(T1, a)
    const session = sessionFor(a.id, T1, { status: 'complete', payment_status: 'paid' })
    expect(
      (await deliver(completed(session, 'checkout.session.async_payment_succeeded'))).status
    ).toBe(200)
    expect((await tootPayment(testDb(), a.id, T1))?.paidAt).toBeInstanceOf(Date)
  })

  it('refuses a forged or stale event, and changes nothing', async () => {
    const a = await signUp('A')
    stubStripe(sessionFor(a.id, T1))
    await checkout(T1, a)
    const event = completed(sessionFor(a.id, T1, { status: 'complete', payment_status: 'paid' }))

    const forged = await deliver(event, { secret: 'whsec_forgedByAnAttacker' })
    expect(forged.status).toBe(400)
    expect(await forged.json()).toEqual({ error: 'invalid_signature' })
    const stale = await deliver(event, { timestamp: Math.floor(Date.now() / 1000) - 3600 })
    expect(stale.status).toBe(400)

    const unsigned = await webhookRoute.POST(
      new Request(`${ORIGIN}/api/stripe/webhook/`, {
        method: 'POST',
        headers: { host: 'staging.farty.fm' },
        body: JSON.stringify(event)
      })
    )
    expect(unsigned.status).toBe(400)
    expect((await tootPayment(testDb(), a.id, T1))?.paidAt).toBeNull()
  })

  it('changes nothing for an unpaid, live, mismatched or other event', async () => {
    const a = await signUp('A')
    const b = await signUp('B')
    stubStripe(sessionFor(a.id, T1))
    await checkout(T1, a)
    const paidSession = sessionFor(a.id, T1, { status: 'complete', payment_status: 'paid' })
    const events = [
      completed(sessionFor(a.id, T1, { status: 'complete' })),
      completed({ ...paidSession, livemode: true }),
      { ...completed(paidSession), livemode: true },
      completed({ ...paidSession, metadata: { user_id: b.id, toot_id: T1 } }),
      completed({ ...paidSession, client_reference_id: T2 }),
      completed(paidSession, 'checkout.session.expired'),
      completed(sessionFor(a.id, T2, { status: 'complete', payment_status: 'paid' })),
      { type: 'customer.created', livemode: false, data: { object: { id: 'cus_test_1' } } }
    ]
    for (const event of events) expect((await deliver(event)).status).toBe(200)
    expect((await tootPayment(testDb(), a.id, T1))?.paidAt).toBeNull()
    expect(await tootPayment(testDb(), a.id, T2)).toBeNull()
    expect(await tootPayment(testDb(), b.id, T1)).toBeNull()
  })

  it('refuses a body far larger than an event', async () => {
    const huge = { type: 'checkout.session.completed', padding: 'x'.repeat(300 * 1024) }
    expect((await deliver(huge)).status).toBe(413)
  })

  it('answers 503 without its webhook secret, or off Stripe', async () => {
    const event = { type: 'customer.created', livemode: false }
    delete extraEnv.STRIPE_WEBHOOK_SECRET
    expect((await deliver(event)).status).toBe(503)
    delete extraEnv.STRIPE_SECRET_KEY
    expect((await deliver(event)).status).toBe(503)
  })

  it('answers 500 when it fails, so Stripe sends the event again, and logs no event data', async () => {
    const a = await signUp('A')
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    extraEnv.DB = undefined
    const event = completed(sessionFor(a.id, T1, { status: 'complete', payment_status: 'paid' }))

    const failed = await deliver(event)

    expect(failed.status).toBe(500)
    expect(await failed.json()).toEqual({ error: 'server_error' })
    expect(failed.headers.get('cache-control')).toBe('no-store')
    const lines = logged.mock.calls.map(([line]) => String(line))
    expect(lines.map(line => JSON.parse(line))).toEqual([
      routeFailureLine('stripe_webhook_failed', 'TypeError', 'POST', '/api/stripe/webhook/')
    ])
    expect(lines[0]).not.toContain(a.id)
    expect(lines[0]).not.toContain(T1)
  })
})

describe('on Production', () => {
  it('saves a Toot free, with no checkout', async () => {
    extraEnv.SITE_ENV = 'production'
    const a = await signUp('A')
    const stripe = vi.spyOn(globalThis, 'fetch')
    expect(await (await checkout(T1, a)).json()).toEqual({ paid: true })
    expect(await paid(T1, a)).toBe(true)
    expect((await save(T1, a)).status).toBe(201)
    expect((await payDev(T1, a)).status).toBe(404)
    expect(stripe).not.toHaveBeenCalled()
  })
})
