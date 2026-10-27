import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as devCheckoutRoute from '@/app/api/dev/checkout/route'
import * as webhookRoute from '@/app/api/stripe/webhook/route'
import * as checkoutRoute from '@/app/api/toots/[id]/checkout/route'
import * as paymentRoute from '@/app/api/toots/[id]/payment/route'
import { startTootPayment, tootPayment } from '@/db/payments'
import { TOOT_PRICE } from '@/lib/pricing'
import type { CheckoutSession, Payments } from '@/server/stripe'
import { devCheckoutServes, PAYMENT_LIMITS, receiveStripeEvent } from '@/server/toot-payments'
import {
  api,
  ORIGIN,
  signUp,
  testDb,
  tootMetadata,
  uploadBody,
  wav
} from '@/test-support/library-api'

// Paying to save a Toot (ADR 0010), in workerd with a real D1: a Toot uploads only once it's paid
// for, through the dev checkout on a local run or Stripe Checkout (its API stubbed) with its
// webhook. Saving stays free on Production.

/** What the Worker's env has on top of wrangler.jsonc's, as each test sets it. */
const extraEnv = vi.hoisted(() => ({}) as Record<string, unknown>)
vi.mock('@opennextjs/cloudflare', async () => {
  const { env } = await import('cloudflare:test')
  return { getCloudflareContext: () => ({ env: { ...env, ...extraEnv } }) }
})

// Made-up values in Stripe's formats, never real keys.
const TEST_KEY = 'sk_test_madeUpForTheTests'
const LIVE_KEY = 'sk_live_madeUpForTheTests'
const WEBHOOK_SECRET = 'whsec_madeUpForTheTests'

const T1 = '33333333-3333-4333-8333-333333333333'
const T2 = '44444444-4444-4444-8444-444444444444'
const T3 = '55555555-5555-4555-8555-555555555555'
/** The test requests' host: a local run on this machine. */
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

/** The user's Toots in D1, deleted ones included. */
async function tootRows(userId: string) {
  const { results } = await env.DB.prepare(
    'select id, deleted_at from toots where user_id = ?1 order by id'
  )
    .bind(userId)
    .all<{ id: string; deleted_at: number | null }>()
  return results
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

  it('saves a paid Toot once: deleted, it can’t be saved again, even once its tombstone is purged', async () => {
    const a = await signUp('A')
    await checkout(T1, a)
    await payDev(T1, a)
    expect((await save(T1, a)).status).toBe(201)
    expect((await tootPayment(testDb(), a.id, T1))?.savedAt).toBeInstanceOf(Date)
    expect((await api.delete('toots', T1, a)).status).toBe(204)
    expect((await save(T1, a)).status).toBe(410)

    // 30 days on, the delete's tombstone is purged (`purgeTombstones`).
    await env.DB.prepare('delete from toots where user_id = ?1').bind(a.id).run()
    expect(await tootRows(a.id)).toEqual([])
    const again = await save(T1, a)
    expect(again.status).toBe(410)
    expect(await again.json()).toEqual({ error: 'deleted' })
    expect(await (await checkout(T1, a)).json()).toEqual({ error: 'deleted' })
    expect(await tootRows(a.id)).toEqual([])
  })

  it('saves a paid Toot once when two saves cross', async () => {
    const a = await signUp('A')
    await checkout(T1, a)
    await payDev(T1, a)
    const statuses = (await Promise.all([save(T1, a), save(T1, a)])).map(r => r.status)
    expect(statuses.sort()).toEqual([200, 201])
    expect(await tootRows(a.id)).toEqual([{ id: T1, deleted_at: null }])
  })

  it('offers a paid Toot of the Song that was never saved, rather than a second payment', async () => {
    const a = await signUp('A')
    await checkout(T1, a)
    await payDev(T1, a)
    // The page closed before the return saved T1. Save on a new Toot of the same Song:
    const offered = await checkout(T2, a)
    expect(offered.status).toBe(200)
    expect(await offered.json()).toEqual({ paidToot: T1 })
    expect(await tootPayment(testDb(), a.id, T2)).toBeNull()
    expect(await tootPayment(testDb(), a.id, T1)).toMatchObject({ songId: 'twinkle' })
    // Another Song's Toot pays as usual.
    expect(await (await checkout(T3, a, 'mary')).json()).toEqual({
      url: `${ORIGIN}/dev/checkout/?toot=${T3}&song=mary`
    })

    // Saved, T1 is offered no more.
    expect((await save(T1, a)).status).toBe(201)
    expect(await (await checkout(T2, a)).json()).toEqual({
      url: `${ORIGIN}/dev/checkout/?toot=${T2}&song=twinkle`
    })
  })

  it('never offers another user’s paid Toot, or one saved and deleted', async () => {
    const a = await signUp('A')
    const b = await signUp('B')
    await checkout(T1, a)
    await payDev(T1, a)
    expect(await (await checkout(T2, b)).json()).toHaveProperty('url')
    expect((await save(T1, a)).status).toBe(201)
    expect((await api.delete('toots', T1, a)).status).toBe(204)
    expect(await (await checkout(T2, a)).json()).toHaveProperty('url')
  })

  it('limits how many checkouts one user starts', async () => {
    const a = await signUp('A')
    const b = await signUp('B')
    const { max, window } = PAYMENT_LIMITS.checkouts
    for (let i = 0; i < max; i++) expect((await checkout(T1, a)).status).toBe(200)
    const limited = await checkout(T1, a)
    expect(limited.status).toBe(429)
    expect(await limited.json()).toEqual({ error: 'rate_limited' })
    const retryAfter = Number(limited.headers.get('retry-after'))
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(window)
    expect((await checkout(T2, a)).status).toBe(429)
    // Another user's are their own, and a paid Toot needs no checkout to save.
    expect((await checkout(T1, b)).status).toBe(200)
    await payDev(T1, a)
    expect(await (await checkout(T1, a)).json()).toEqual({ paid: true })
    expect((await save(T1, a)).status).toBe(201)
  })

  it('refuses a deleted Toot, and one past the Toot limit, before anything is paid', async () => {
    const a = await signUp('A')
    await env.DB.prepare(
      `insert into toots (user_id, id, title, song_id, created_at, seconds, arrangement,
        audio_bytes, updated_at, deleted_at)
       values (?1, ?2, '', 'twinkle', 0, 0.1, '{"transposition":0,"recordingForPitch":{}}', 100,
        0, 0)`
    )
      .bind(a.id, T1)
      .run()
    expect(await (await checkout(T1, a)).json()).toEqual({ error: 'deleted' })

    // 300 live Toots, the limit.
    await env.DB.prepare(
      `with recursive n(i) as (select 1 union all select i + 1 from n where i < 300)
       insert into toots (user_id, id, title, song_id, created_at, seconds, arrangement,
         audio_bytes, updated_at)
       select ?1, 'toot-' || i, '', 'twinkle', 0, 0.1,
         '{"transposition":0,"recordingForPitch":{}}', 100, 0 from n`
    )
      .bind(a.id)
      .run()
    const full = await checkout(T2, a)
    expect(full.status).toBe(409)
    expect(await full.json()).toEqual({ error: 'limit_reached' })
    expect(await tootPayment(testDb(), a.id, T2)).toBeNull()
  })
})

const sessionFor = (
  userId: string,
  tootId: string,
  fields: Partial<CheckoutSession> = {}
): CheckoutSession => ({
  id: 'cs_test_first',
  url: 'https://checkout.stripe.com/c/pay/cs_test_first',
  mode: 'payment',
  status: 'open',
  payment_status: 'unpaid',
  client_reference_id: tootId,
  metadata: { user_id: userId, toot_id: tootId },
  livemode: false,
  amount_total: 99,
  currency: 'usd',
  ...fields
})

/** Stripe's API, answering each request with the next of `answers`, and what was asked. */
function stubStripe(...answers: (CheckoutSession | Response)[]) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    const next = answers.shift()
    if (!next) throw new Error('Stripe was asked once too often')
    return next instanceof Response ? next : Response.json(next)
  })
}

const encoder = new TextEncoder()

/** `Stripe-Signature` for `payload` at `timestamp`, as Stripe makes it. */
async function signature(payload: string, timestamp: number, secret = WEBHOOK_SECRET) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${payload}`))
  )
  const hex = Array.from(mac, byte => byte.toString(16).padStart(2, '0')).join('')
  return `t=${timestamp},v1=${hex}`
}

/** Stripe's request with `event`, signed with `secret` at `timestamp` (now, unless a test says). */
async function eventRequest(
  event: unknown,
  { secret = WEBHOOK_SECRET, timestamp = Math.floor(Date.now() / 1000) } = {}
) {
  const payload = JSON.stringify(event)
  return new Request(`${ORIGIN}/api/stripe/webhook/`, {
    method: 'POST',
    headers: {
      host: 'staging.farty.fm',
      'content-type': 'application/json',
      'stripe-signature': await signature(payload, timestamp, secret)
    },
    body: payload
  })
}

/** Stripe sends `event` to the webhook. */
async function deliver(event: unknown, signing: { secret?: string; timestamp?: number } = {}) {
  return webhookRoute.POST(await eventRequest(event, signing))
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
    // Two requests that cross, or a retry, get this session from Stripe, not a second one.
    expect(new Headers(init?.headers).get('idempotency-key')).toBe(
      `toot-checkout/${a.id}/${T1}/first`
    )
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

  it('starts a new session once the last one expired', async () => {
    const a = await signUp('A')
    const next = sessionFor(a.id, T1, {
      id: 'cs_test_second',
      url: 'https://checkout.stripe.com/c/pay/cs_test_second'
    })
    const stripe = stubStripe(
      sessionFor(a.id, T1),
      sessionFor(a.id, T1, { status: 'expired', url: null }),
      next
    )
    await checkout(T1, a)
    expect(await (await checkout(T1, a)).json()).toEqual({ url: next.url })
    expect((await tootPayment(testDb(), a.id, T1))?.checkoutSessionId).toBe('cs_test_second')
    // A new idempotency key, or Stripe would answer with the expired one.
    expect(new Headers(stripe.mock.calls[2][1]?.headers).get('idempotency-key')).toBe(
      `toot-checkout/${a.id}/${T1}/cs_test_first`
    )
  })

  it('starts a new session when Stripe no longer has the last one', async () => {
    const a = await signUp('A')
    const next = sessionFor(a.id, T1, {
      id: 'cs_test_second',
      url: 'https://checkout.stripe.com/c/pay/cs_test_second'
    })
    const gone = () => Response.json({ error: { message: 'No such session' } }, { status: 404 })
    stubStripe(sessionFor(a.id, T1), gone(), gone(), next)
    await checkout(T1, a)
    expect(await paid(T1, a)).toBe(false)
    expect(await (await checkout(T1, a)).json()).toEqual({ url: next.url })
    expect((await tootPayment(testDb(), a.id, T1))?.checkoutSessionId).toBe('cs_test_second')
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

  it('never takes a session that charged anything but the Toot’s price as paid', async () => {
    const a = await signUp('A')
    const paidSession = sessionFor(a.id, T1, { status: 'complete', payment_status: 'paid' })
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
    const local = sessionFor(a.id, T1, {
      status: 'complete',
      payment_status: 'paid',
      presentment_details: { presentment_currency: 'jpy', presentment_amount: 163 }
    })
    expect((await deliver(completed(local))).status).toBe(200)
    expect(await paid(T1, a)).toBe(true)
    expect((await save(T1, a)).status).toBe(201)
  })

  it('takes a session paid at the price its checkout started at, after the price changed', async () => {
    const a = await signUp('A')
    // The checkout started when a Toot cost 149, and TOOT_PRICE has changed since.
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
    // Stripe was asked about that session, and no new one was made.
    expect(stripe.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api.stripe.com/v1/checkout/sessions/cs_test_first'
    ])
    expect((await tootPayment(testDb(), a.id, T1))?.paidAt).toBeInstanceOf(Date)
    expect((await save(T1, a)).status).toBe(201)

    // The webhook judges by the row's price too.
    await startTootPayment(testDb(), a.id, T2, 'twinkle', 'cs_test_second', before)
    const webhookPaid = { ...paidThen, id: 'cs_test_second', client_reference_id: T2 }
    webhookPaid.metadata = { user_id: a.id, toot_id: T2 }
    expect((await deliver(completed(webhookPaid))).status).toBe(200)
    expect((await tootPayment(testDb(), a.id, T2))?.paidAt).toBeInstanceOf(Date)
  })

  it('never starts a second payment for a Toot whose last session is paid at another price', async () => {
    const a = await signUp('A')
    const stripe = stubStripe(
      sessionFor(a.id, T1),
      sessionFor(a.id, T1, { status: 'complete', payment_status: 'paid', amount_total: 1 })
    )
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

    // The webhook still marks it paid, and D1 says so.
    const session = sessionFor(a.id, T1, { status: 'complete', payment_status: 'paid' })
    expect((await deliver(completed(session))).status).toBe(200)
    expect(await paid(T1, a)).toBe(true)
    expect(stripe).toHaveBeenCalledTimes(max)
  })

  it('offers a paid Toot of the Song never saved, without asking Stripe again', async () => {
    const a = await signUp('A')
    stubStripe(sessionFor(a.id, T1))
    await checkout(T1, a)
    const session = sessionFor(a.id, T1, { status: 'complete', payment_status: 'paid' })
    await deliver(completed(session))
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

    const event = completed(sessionFor(a.id, T1, { status: 'complete', payment_status: 'paid' }))
    const received = await deliver(event)
    expect(received.status).toBe(200)
    expect(received.headers.get('cache-control')).toBe('no-store')
    expect(await paid(T1, a)).toBe(true)
    expect((await save(T1, a)).status).toBe(201)
    // Stripe sends an event again until it's answered: a second delivery changes nothing.
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
})

describe('live and test mode', () => {
  const payments = (livemode: boolean): Payments => ({
    kind: 'stripe',
    secretKey: livemode ? LIVE_KEY : TEST_KEY,
    webhookSecret: WEBHOOK_SECRET,
    livemode
  })

  it('takes only live events in live mode, and only test events in test mode', async () => {
    const a = await signUp('A')
    await startTootPayment(testDb(), a.id, T1, 'twinkle', 'cs_live_first', TOOT_PRICE)
    await startTootPayment(testDb(), a.id, T2, 'twinkle', 'cs_test_first', TOOT_PRICE)
    const live = sessionFor(a.id, T1, {
      id: 'cs_live_first',
      status: 'complete',
      payment_status: 'paid',
      livemode: true
    })
    const test = sessionFor(a.id, T2, { status: 'complete', payment_status: 'paid' })
    const receive = async (livemode: boolean, session: CheckoutSession) => {
      const request = await eventRequest(completed(session))
      return (await receiveStripeEvent({ db: testDb() }, payments(livemode), request)).status
    }

    expect(await receive(true, test)).toBe(200)
    expect(await receive(false, live)).toBe(200)
    expect((await tootPayment(testDb(), a.id, T1))?.paidAt).toBeNull()
    expect((await tootPayment(testDb(), a.id, T2))?.paidAt).toBeNull()

    expect(await receive(true, live)).toBe(200)
    expect(await receive(false, test)).toBe(200)
    expect((await tootPayment(testDb(), a.id, T1))?.paidAt).toBeInstanceOf(Date)
    expect((await tootPayment(testDb(), a.id, T2))?.paidAt).toBeInstanceOf(Date)
  })
})

describe('on Staging', () => {
  beforeEach(() => {
    extraEnv.SITE_ENV = 'staging'
  })

  it('pays through Stripe in test mode, with no dev checkout', async () => {
    extraEnv.STRIPE_SECRET_KEY = TEST_KEY
    const a = await signUp('A')
    const stripe = stubStripe(sessionFor(a.id, T1))
    expect(await (await checkout(T1, a)).json()).toEqual({
      url: 'https://checkout.stripe.com/c/pay/cs_test_first'
    })
    expect(stripe).toHaveBeenCalledOnce()
    expect((await payDev(T1, a)).status).toBe(404)
    expect(devCheckoutServes(HOST)).toBe(false)
    expect((await save(T1, a)).status).toBe(402)
  })

  it('takes no payment without a test key, and never stands in for Checkout', async () => {
    const a = await signUp('A')
    const stripe = vi.spyOn(globalThis, 'fetch')
    for (const key of [undefined, LIVE_KEY, 'rk_live_madeUpForTheTests']) {
      extraEnv.STRIPE_SECRET_KEY = key
      const refused = await checkout(T1, a)
      expect(refused.status).toBe(503)
      expect(await refused.json()).toEqual({ error: 'payments_unavailable' })
      expect((await payDev(T1, a)).status).toBe(404)
      expect(devCheckoutServes(HOST)).toBe(false)
    }
    expect((await save(T1, a)).status).toBe(402)
    expect(stripe).not.toHaveBeenCalled()
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
