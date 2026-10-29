import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as webhookRoute from '@/app/api/stripe/webhook/route'
import { startTootPayment, tootPayment } from '@/db/payments'
import { TOOT_PRICE } from '@/lib/pricing'
import { PAYMENT_LIMITS } from '@/server/toot-payments'
import { extraEnv } from '@/test-support/extra-env'
import { ORIGIN, routeFailureLine, signUp, T1, testDb } from '@/test-support/library-api'
import {
  checkout,
  completed,
  deliver,
  expectSavedOnceStripeSaysPaid,
  paid,
  paymentsHarness,
  save,
  stubStripe,
  T2
} from '@/test-support/payments-api'
import { checkoutSession as sessionFor, TEST_KEY, WEBHOOK_SECRET } from '@/test-support/stripe'

vi.mock('@opennextjs/cloudflare', async () =>
  (await import('@/test-support/extra-env')).cloudflareWithExtraEnv()
)

paymentsHarness()

const paidSessionFor = (userId: string, tootId: string) =>
  sessionFor(userId, tootId, { status: 'complete', payment_status: 'paid' })

const idempotencyKeyOf = (init: RequestInit | undefined) =>
  new Headers(init?.headers).get('idempotency-key')

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
    expect(idempotencyKeyOf(init)).toBe(`toot-checkout/${a.id}/${T1}/first`)
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
    const stripe = stubStripe(sessionFor(a.id, T1), expired, secondSession(a.id))
    await checkout(T1, a)
    await expectSecondSession(a)
    expect(idempotencyKeyOf(stripe.mock.calls[2][1])).toBe(
      `toot-checkout/${a.id}/${T1}/cs_test_first`
    )
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
    stubStripe(sessionFor(a.id, T1), sessionFor(a.id, T1), paidSessionFor(a.id, T1))
    await checkout(T1, a)
    expect(await paid(T1, a)).toBe(false)
    await expectSavedOnceStripeSaysPaid(T1, a)
  })

  it('never takes a session that charged anything but the Toot’s price as paid', async () => {
    const a = await signUp('A')
    const paidSession = paidSessionFor(a.id, T1)
    stubStripe(
      sessionFor(a.id, T1),
      { ...paidSession, amount_total: 1 },
      { ...paidSession, currency: 'eur' }
    )
    await checkout(T1, a)
    expect(await paid(T1, a)).toBe(false)
    expect(await paid(T1, a)).toBe(false)
    for (const wrong of [{ amount_total: 0 }, { amount_total: null }, { currency: 'jpy' }]) {
      expect((await deliver(completed({ ...paidSession, ...wrong }))).status).toBe(200)
    }
    expect((await tootPayment(testDb(), a.id, T1))?.paidAt).toBeNull()
    expect((await save(T1, a)).status).toBe(402)
  })

  it('takes a payment in the buyer’s own currency (Adaptive Pricing): the session keeps 99 usd', async () => {
    const a = await signUp('A')
    stubStripe(sessionFor(a.id, T1))
    await checkout(T1, a)
    const local = {
      ...paidSessionFor(a.id, T1),
      presentment_details: { presentment_currency: 'jpy', presentment_amount: 163 }
    }
    expect((await deliver(completed(local))).status).toBe(200)
    expect(await paid(T1, a)).toBe(true)
    expect((await save(T1, a)).status).toBe(201)
  })

  it('takes a session paid at the price its checkout started at, after the price changed', async () => {
    const a = await signUp('A')
    const before = { amount: 149, currency: 'usd' }
    expect(before.amount).not.toBe(TOOT_PRICE.amount)
    await startTootPayment(testDb(), a.id, T1, 'twinkle', 'cs_test_first', before)
    const paidThen = sessionFor(a.id, T1, {
      status: 'complete',
      payment_status: 'paid',
      amount_total: before.amount
    })
    const stripe = stubStripe(paidThen)
    expect(await (await checkout(T1, a)).json()).toEqual({ paid: true })
    expect(stripe.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api.stripe.com/v1/checkout/sessions/cs_test_first'
    ])
    expect((await tootPayment(testDb(), a.id, T1))?.paidAt).toBeInstanceOf(Date)
    expect((await save(T1, a)).status).toBe(201)

    await startTootPayment(testDb(), a.id, T2, 'twinkle', 'cs_test_second', before)
    const webhookPaid = { ...paidThen, id: 'cs_test_second', client_reference_id: T2 }
    webhookPaid.metadata = { user_id: a.id, toot_id: T2 }
    expect((await deliver(completed(webhookPaid))).status).toBe(200)
    expect((await tootPayment(testDb(), a.id, T2))?.paidAt).toBeInstanceOf(Date)
  })

  it('never starts a second payment for a Toot whose last session is paid at another price', async () => {
    const a = await signUp('A')
    const stripe = stubStripe(sessionFor(a.id, T1), {
      ...paidSessionFor(a.id, T1),
      amount_total: 1
    })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await checkout(T1, a)
    const refused = await checkout(T1, a)
    expect(refused.status).toBe(409)
    expect(await refused.json()).toEqual({ error: 'payment_mismatch' })
    expect(stripe).toHaveBeenCalledTimes(2)
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({ event: 'stripe_paid_session_refused', session: 'cs_test_first' })
    )
    expect((await tootPayment(testDb(), a.id, T1))?.paidAt).toBeNull()
  })

  it('asks Stripe only so often while a return waits, then answers from D1', async () => {
    const a = await signUp('A')
    stubStripe(sessionFor(a.id, T1))
    await checkout(T1, a)
    vi.restoreAllMocks()
    const stripe = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => Response.json(sessionFor(a.id, T1)))
    const { max } = PAYMENT_LIMITS.stripeChecks
    for (let i = 0; i < max; i++) expect(await paid(T1, a)).toBe(false)
    expect(stripe).toHaveBeenCalledTimes(max)
    expect(await paid(T1, a)).toBe(false)
    expect(stripe).toHaveBeenCalledTimes(max)

    expect((await deliver(completed(paidSessionFor(a.id, T1)))).status).toBe(200)
    expect(await paid(T1, a)).toBe(true)
    expect(stripe).toHaveBeenCalledTimes(max)
  })

  it('offers a paid Toot of the Song never saved, without asking Stripe again', async () => {
    const a = await signUp('A')
    stubStripe(sessionFor(a.id, T1))
    await checkout(T1, a)
    await deliver(completed(paidSessionFor(a.id, T1)))
    vi.restoreAllMocks()
    const stripe = vi.spyOn(globalThis, 'fetch')
    expect(await (await checkout(T2, a)).json()).toEqual({ paidToot: T1 })
    expect(stripe).not.toHaveBeenCalled()
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

    const event = completed(paidSessionFor(a.id, T1))
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
    const session = paidSessionFor(a.id, T1)
    expect(
      (await deliver(completed(session, 'checkout.session.async_payment_succeeded'))).status
    ).toBe(200)
    expect((await tootPayment(testDb(), a.id, T1))?.paidAt).toBeInstanceOf(Date)
  })

  it('refuses a forged or stale event, and changes nothing', async () => {
    const a = await signUp('A')
    stubStripe(sessionFor(a.id, T1))
    await checkout(T1, a)
    const event = completed(paidSessionFor(a.id, T1))

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
    const paidSession = paidSessionFor(a.id, T1)
    const events = [
      completed(sessionFor(a.id, T1, { status: 'complete' })),
      completed({ ...paidSession, livemode: true }),
      { ...completed(paidSession), livemode: true },
      completed({ ...paidSession, metadata: { user_id: b.id, toot_id: T1 } }),
      completed({ ...paidSession, client_reference_id: T2 }),
      completed(paidSession, 'checkout.session.expired'),
      completed(paidSessionFor(a.id, T2)),
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
    const event = completed(paidSessionFor(a.id, T1))

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
