import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as devCheckoutRoute from '@/app/api/dev/checkout/route'
import * as checkoutRoute from '@/app/api/full-access/checkout/route'
import * as accessRoute from '@/app/api/full-access/route'
import * as webhookRoute from '@/app/api/stripe/webhook/route'
import { fullAccessPurchase, startFullAccess, tootPayment } from '@/db/payments'
import { stepCounts } from '@/db/schema'
import { FULL_ACCESS_PRICE } from '@/lib/pricing'
import {
  devCheckoutServes,
  getFullAccess,
  PAYMENT_LIMITS,
  receiveStripeEvent,
  startCheckout
} from '@/server/full-access'
import type { CheckoutSession, Payments } from '@/server/stripe'
import {
  api,
  ORIGIN,
  padTootMetadata,
  signUp,
  testDb,
  tootMetadata,
  uploadBody,
  wav
} from '@/test-support/library-api'

// Paying for Full Access (ADR 0022), in workerd with a real D1: a new Toot uploads only on an
// account that has it, through the dev checkout on a local run or Stripe Checkout (its API stubbed)
// with its webhook. Production pays the same way, in live mode (#258).

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
const noParams = { params: Promise.resolve({}) }

beforeEach(() => {
  for (const key of Object.keys(extraEnv)) delete extraEnv[key]
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** The funnel's count of `step` (#405), over every day. */
async function counted(step: string): Promise<number> {
  const rows = await testDb().select().from(stepCounts)
  return rows.filter(row => row.step === step).reduce((sum, row) => sum + row.count, 0)
}

type As = { cookie?: string; library?: string; host?: string }

function headersFor(method: string, { cookie, library, host = HOST }: As, extra: HeadersInit = {}) {
  const headers = new Headers(extra)
  headers.set('host', host)
  if (cookie) headers.set('cookie', cookie)
  if (library) headers.set('x-pedos-library', library)
  if (method !== 'GET') headers.set('origin', ORIGIN)
  return headers
}

const checkoutRequest = (as: As, body: unknown) =>
  new Request(`${ORIGIN}/api/full-access/checkout/`, {
    method: 'POST',
    headers: headersFor('POST', as, { 'content-type': 'application/json' }),
    body: JSON.stringify(body)
  })

const checkout = (tootId: string, as: As, songId: unknown = 'twinkle') =>
  checkoutRoute.POST(checkoutRequest(as, { tootId, songId }), noParams)

const accessRequest = (as: As, query = '') =>
  new Request(`${ORIGIN}/api/full-access/${query}`, { headers: headersFor('GET', as) })

const access = (as: As, query = '') => accessRoute.GET(accessRequest(as, query), noParams)

/** The dev checkout's Pay, for a Toot of `song`, or with no `song` for a Sound Pad Toot. */
const payDev = (toot: string, as: As, song: string | null = 'twinkle') =>
  devCheckoutRoute.POST(
    new Request(`${ORIGIN}/api/dev/checkout/`, {
      method: 'POST',
      headers: headersFor('POST', as, { 'content-type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams(song === null ? { toot } : { toot, song })
    }),
    noParams
  )

const save = (id: string, as: As) =>
  api.put('toots', id, uploadBody(tootMetadata(id), wav()), as, {
    headers: { host: as.host ?? HOST }
  })

/** Saves the Sound Pad Toot `id` (ADR 0017). */
const savePad = (id: string, as: As) =>
  api.put('toots', id, uploadBody(padTootMetadata(id), wav()), as, {
    headers: { host: as.host ?? HOST }
  })

async function hasIt(as: As): Promise<boolean> {
  const response = await access(as)
  expect(response.status).toBe(200)
  return ((await response.json()) as { active: boolean }).active
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

/** `count` live Toots, in D1 alone. */
async function fillToots(userId: string, count: number) {
  await env.DB.prepare(
    `with recursive n(i) as (select 1 union all select i + 1 from n where i < ?2)
     insert into toots (user_id, id, title, song_id, created_at, seconds, arrangement,
       audio_bytes, updated_at)
     select ?1, 'toot-' || i, '', 'twinkle', 0, 0.1,
       '{"transposition":0,"recordingForPitch":{}}', 100, 0 from n`
  )
    .bind(userId, count)
    .run()
}

/** A 99¢ payment for a Toot, from before Full Access (ADR 0010). */
async function pastPayment(
  userId: string,
  tootId: string,
  { paidAt = 1, refundedAt = null }: { paidAt?: number | null; refundedAt?: number | null } = {}
) {
  await env.DB.prepare(
    `insert into toot_payments (user_id, toot_id, checkout_session_id, amount, currency, song_id,
       created_at, paid_at, refunded_at)
     values (?1, ?2, ?3, 99, 'usd', 'twinkle', 0, ?4, ?5)`
  )
    .bind(userId, tootId, `cs_test_old_${tootId}`, paidAt, refundedAt)
    .run()
}

describe('on a local run, with the dev checkout', () => {
  it('saves every Toot once the account has Full Access, for one payment, and none before', async () => {
    const a = await signUp('A')
    expect(await (await save(T1, a)).json()).toEqual({ error: 'payment_required' })
    expect((await save(T1, a)).status).toBe(402)

    const started = await checkout(T1, a)
    expect(started.status).toBe(200)
    expect(started.headers.get('cache-control')).toBe('private, no-store')
    expect(await started.json()).toEqual({
      url: `${ORIGIN}/dev/checkout/?toot=${T1}&song=twinkle`
    })
    expect(await counted('checkout-started')).toBe(1)
    expect(await counted('paid')).toBe(0)
    expect(await hasIt(a)).toBe(false)
    expect((await save(T1, a)).status).toBe(402)

    const paying = await payDev(T1, a)
    expect(paying.status).toBe(303)
    expect(paying.headers.get('location')).toBe(
      `${ORIGIN}/compose/twinkle/?toot=${T1}&checkout=done`
    )
    expect(await hasIt(a)).toBe(true)
    expect(await counted('paid')).toBe(1)
    expect((await save(T1, a)).status).toBe(201)

    // The next Toots, of any Song or the Sound Pad, need nothing more.
    expect((await save(T2, a)).status).toBe(201)
    expect((await savePad(T3, a)).status).toBe(201)
    expect(await (await checkout(T1, a)).json()).toEqual({ active: true })
    expect(await counted('checkout-started')).toBe(1)
    expect(await counted('paid')).toBe(1)
  })

  it('records one purchase, at the price it started at', async () => {
    const a = await signUp('A')
    await checkout(T1, a)
    await checkout(T2, a)
    await payDev(T2, a)
    expect(await fullAccessPurchase(testDb(), a.id)).toMatchObject({
      amount: FULL_ACCESS_PRICE.amount,
      currency: FULL_ACCESS_PRICE.currency,
      refundedAt: null
    })
    expect((await fullAccessPurchase(testDb(), a.id))?.paidAt).toBeInstanceOf(Date)
    // The price itself: a change to it is a deliberate one, with its copy.
    expect(FULL_ACCESS_PRICE).toEqual({ amount: 499, currency: 'usd' })
  })

  it('never lets one user pay for, or use, another’s Full Access', async () => {
    const a = await signUp('A')
    const b = await signUp('B')
    await checkout(T1, a)
    expect((await payDev(T1, b)).status).toBe(404)
    expect(await hasIt(a)).toBe(false)
    await payDev(T1, a)
    expect(await hasIt(b)).toBe(false)
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
    expect((await fullAccessPurchase(testDb(), a.id))?.paidAt).toBeNull()
  })

  it('keeps the score a paid Toot was rendered from (#254)', async () => {
    const a = await signUp('A')
    await checkout(T1, a)
    await payDev(T1, a)
    const score = {
      bpm: 90,
      bar_lines: [0],
      length_beats: 4,
      notes: [{ start: 0, dur: 4, pitch: 60 }]
    }
    const saved = await api.put('toots', T1, uploadBody(tootMetadata(T1, { score }), wav()), a, {
      headers: { host: HOST }
    })
    expect(saved.status).toBe(201)
    const row = await env.DB.prepare('select score from toots where user_id = ?1')
      .bind(a.id)
      .first<{ score: string }>()
    expect(JSON.parse(row?.score ?? 'null')).toEqual(score)
  })

  it('pays from a Sound Pad Toot, back to the Sound Pad, and then a Song’s saves too (ADR 0017)', async () => {
    const a = await signUp('A')
    expect(await (await savePad(T1, a)).json()).toEqual({ error: 'payment_required' })
    expect((await savePad(T1, a)).status).toBe(402)

    const started = await checkout(T1, a, null)
    expect(started.status).toBe(200)
    expect(await started.json()).toEqual({ url: `${ORIGIN}/dev/checkout/?toot=${T1}` })
    expect((await savePad(T1, a)).status).toBe(402)

    const paying = await payDev(T1, a, null)
    expect(paying.status).toBe(303)
    expect(paying.headers.get('location')).toBe(`${ORIGIN}/compose/pad/?toot=${T1}&checkout=done`)
    expect(await hasIt(a)).toBe(true)
    expect((await savePad(T1, a)).status).toBe(201)
    const library = (await (await api.library(a)).json()) as { toots: unknown[] }
    expect(library.toots).toMatchObject([
      { id: T1, songId: null, arrangement: null, performance: padTootMetadata(T1).performance }
    ])
    expect((await save(T2, a)).status).toBe(201)
  })

  it('refuses a checkout for a bad id, an unknown Song, or another library', async () => {
    const a = await signUp('A')
    expect((await checkout('not-a-toot', a)).status).toBe(400)
    expect(await (await checkout(T1, a, 'no-such-song')).json()).toEqual({
      error: 'invalid_request'
    })
    // No Song is a Sound Pad Toot only when it says so: `songId: null`.
    const noSongId = await checkoutRoute.POST(checkoutRequest(a, { tootId: T1 }), noParams)
    expect(noSongId.status).toBe(400)
    expect((await checkout(T1, a, '')).status).toBe(400)
    expect((await payDev(T1, a, 'no-such-song')).status).toBe(400)
    expect((await checkout(T1, { ...a, library: 'userB' })).status).toBe(409)
    expect((await access({ ...a, library: 'userB' })).status).toBe(409)
    expect((await checkout(T1, {})).status).toBe(401)
    expect((await access({})).status).toBe(401)
  })

  it('keeps a deleted Toot deleted, and takes no payment for it', async () => {
    const a = await signUp('A')
    await checkout(T1, a)
    await payDev(T1, a)
    expect((await save(T1, a)).status).toBe(201)
    expect((await api.delete('toots', T1, a)).status).toBe(204)
    const again = await save(T1, a)
    expect(again.status).toBe(410)
    expect(await again.json()).toEqual({ error: 'deleted' })
    // Checkout refuses it too, with Full Access, as that Save would be refused.
    const refusedWithIt = await checkout(T1, a)
    expect(refusedWithIt.status).toBe(410)
    expect(await refusedWithIt.json()).toEqual({ error: 'deleted' })

    // Without Full Access, Checkout refuses it before anything is paid.
    const b = await signUp('B')
    await env.DB.prepare(
      `insert into toots (user_id, id, title, song_id, created_at, seconds, arrangement,
        audio_bytes, updated_at, deleted_at)
       values (?1, ?2, '', 'twinkle', 0, 0.1, '{"transposition":0,"recordingForPitch":{}}', 100,
        0, 0)`
    )
      .bind(b.id, T1)
      .run()
    const refused = await checkout(T1, b)
    expect(refused.status).toBe(410)
    expect(await refused.json()).toEqual({ error: 'deleted' })
    expect(await fullAccessPurchase(testDb(), b.id)).toBeNull()
  })

  it('saves a Toot once when two saves cross', async () => {
    const a = await signUp('A')
    await checkout(T1, a)
    await payDev(T1, a)
    const statuses = (await Promise.all([save(T1, a), save(T1, a)])).map(r => r.status)
    expect(statuses.sort()).toEqual([200, 201])
    expect(await tootRows(a.id)).toEqual([{ id: T1, deleted_at: null }])
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
    // Another user's are their own, and the account that's paid needs no checkout to save.
    expect((await checkout(T1, b)).status).toBe(200)
    await payDev(T1, a)
    expect(await (await checkout(T1, a)).json()).toEqual({ active: true })
    expect((await save(T1, a)).status).toBe(201)
  })

  it('refuses a checkout at the Toot limit before anything is paid', async () => {
    const a = await signUp('A')
    await fillToots(a.id, 300)
    const full = await checkout(T2, a)
    expect(full.status).toBe(409)
    expect(await full.json()).toEqual({ error: 'limit_reached' })
    expect(await fullAccessPurchase(testDb(), a.id)).toBeNull()
  })

  it('says when an account with Full Access is at the Toot limit, as Save has to say it', async () => {
    const a = await signUp('A')
    await fillToots(a.id, 299)
    expect(await (await access(a)).json()).toEqual({ active: false, limitReached: false })
    await checkout(T1, a)
    await payDev(T1, a)
    expect(await (await access(a)).json()).toEqual({ active: true, limitReached: false })
    expect((await save(T1, a)).status).toBe(201)
    expect(await (await access(a)).json()).toEqual({ active: true, limitReached: true })
    expect((await save(T2, a)).status).toBe(409)
    // Pay on a sheet shown before this: it says the limit, rather than saving what can't upload.
    const started = await checkout(T2, a)
    expect(started.status).toBe(409)
    expect(await started.json()).toEqual({ error: 'limit_reached' })
  })
})

describe('someone who paid for a Toot before Full Access', () => {
  it('has Full Access, with nothing more to pay', async () => {
    const a = await signUp('A')
    await pastPayment(a.id, T1)
    const stripe = vi.spyOn(globalThis, 'fetch')
    expect(await hasIt(a)).toBe(true)
    expect(await (await checkout(T2, a)).json()).toEqual({ active: true })
    expect((await save(T2, a)).status).toBe(201)
    expect((await savePad(T3, a)).status).toBe(201)
    expect(await fullAccessPurchase(testDb(), a.id)).toBeNull()
    expect(stripe).not.toHaveBeenCalled()
    // Their row stays as it was.
    expect((await tootPayment(testDb(), a.id, T1))?.paidAt).toBeInstanceOf(Date)
  })

  it('doesn’t, from a payment never finished, or refunded, or someone else’s', async () => {
    const a = await signUp('A')
    const b = await signUp('B')
    const c = await signUp('C')
    await pastPayment(a.id, T1, { paidAt: null })
    await pastPayment(b.id, T1, { refundedAt: 2 })
    expect(await hasIt(a)).toBe(false)
    expect(await hasIt(b)).toBe(false)
    expect(await hasIt(c)).toBe(false)
    expect((await save(T2, a)).status).toBe(402)
    expect((await save(T2, b)).status).toBe(402)
  })

  it('still has it from another payment when one is refunded', async () => {
    const a = await signUp('A')
    await pastPayment(a.id, T1)
    await pastPayment(a.id, T2, { refundedAt: 2 })
    expect(await hasIt(a)).toBe(true)
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
  client_reference_id: userId,
  metadata: { purchase: 'full_access', user_id: userId, toot_id: tootId },
  livemode: false,
  amount_total: 499,
  currency: 'usd',
  ...fields
})

/** `sessionFor`, paid. */
const paidSessionFor = (userId: string, tootId: string, fields: Partial<CheckoutSession> = {}) =>
  sessionFor(userId, tootId, {
    status: 'complete',
    payment_status: 'paid',
    payment_intent: 'pi_test_first',
    ...fields
  })

/** A 99¢ Checkout Session from before Full Access, still open when it came. */
const oldSessionFor = (
  userId: string,
  tootId: string,
  fields: Partial<CheckoutSession> = {}
): CheckoutSession => ({
  ...sessionFor(userId, tootId),
  id: `cs_test_old_${tootId}`,
  client_reference_id: tootId,
  metadata: { user_id: userId, toot_id: tootId },
  amount_total: 99,
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

/** Stripe's `charge.refunded`: `refunded` is true only once all of the charge is refunded. */
const refundedCharge = (
  charge: { refunded?: boolean; payment_intent?: string; metadata?: Record<string, string> } = {},
  livemode = false
) => ({
  id: 'evt_test_refund',
  object: 'event',
  type: 'charge.refunded',
  livemode,
  data: {
    object: { id: 'ch_test_1', refunded: true, payment_intent: 'pi_test_first', ...charge }
  }
})

describe('with Stripe Checkout in test mode', () => {
  beforeEach(() => {
    extraEnv.STRIPE_SECRET_KEY = TEST_KEY
    extraEnv.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET
  })

  it('starts a Checkout Session for $4.99, back to the Toot’s Song Creator', async () => {
    const a = await signUp('A')
    const stripe = stubStripe(sessionFor(a.id, T1))
    expect(await (await checkout(T1, a)).json()).toEqual({
      url: 'https://checkout.stripe.com/c/pay/cs_test_first'
    })
    expect(await counted('checkout-started')).toBe(1)
    const [url, init] = stripe.mock.calls[0]
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions')
    // Two requests that cross, or a retry, get this session from Stripe, not a second one.
    expect(new Headers(init?.headers).get('idempotency-key')).toBe(
      `full-access/${a.id}/${T1}/first`
    )
    const sent = init?.body as URLSearchParams
    expect(sent.get('client_reference_id')).toBe(a.id)
    expect(sent.get('metadata[purchase]')).toBe('full_access')
    expect(sent.get('metadata[user_id]')).toBe(a.id)
    expect(sent.get('metadata[toot_id]')).toBe(T1)
    expect(sent.get('customer_email')).toBe(a.email)
    expect(sent.get('line_items[0][price_data][unit_amount]')).toBe('499')
    expect(sent.get('success_url')).toBe(`${ORIGIN}/compose/twinkle/?toot=${T1}&checkout=done`)
    expect(sent.get('cancel_url')).toBe(`${ORIGIN}/compose/twinkle/?toot=${T1}`)
    expect(await fullAccessPurchase(testDb(), a.id)).toMatchObject({
      checkoutSessionId: 'cs_test_first',
      amount: 499,
      currency: 'usd',
      paidAt: null
    })
  })

  it('goes back to the Sound Pad for a Sound Pad Toot (ADR 0017)', async () => {
    const a = await signUp('A')
    const stripe = stubStripe(sessionFor(a.id, T1))
    expect(await (await checkout(T1, a, null)).json()).toEqual({
      url: 'https://checkout.stripe.com/c/pay/cs_test_first'
    })
    const sent = stripe.mock.calls[0][1]?.body as URLSearchParams
    expect(sent.get('line_items[0][price_data][unit_amount]')).toBe('499')
    expect(sent.get('success_url')).toBe(`${ORIGIN}/compose/pad/?toot=${T1}&checkout=done`)
    expect(sent.get('cancel_url')).toBe(`${ORIGIN}/compose/pad/?toot=${T1}`)
  })

  it('reuses an open session for the same Toot, so two taps can’t pay twice', async () => {
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

  it('ends an open session for another Toot first, so only one can be paid', async () => {
    const a = await signUp('A')
    const next = sessionFor(a.id, T2, {
      id: 'cs_test_second',
      url: 'https://checkout.stripe.com/c/pay/cs_test_second'
    })
    const stripe = stubStripe(
      sessionFor(a.id, T1),
      sessionFor(a.id, T1),
      sessionFor(a.id, T1, { status: 'expired', url: null }),
      next
    )
    await checkout(T1, a)
    expect(await (await checkout(T2, a)).json()).toEqual({ url: next.url })
    expect(stripe.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api.stripe.com/v1/checkout/sessions',
      'https://api.stripe.com/v1/checkout/sessions/cs_test_first',
      'https://api.stripe.com/v1/checkout/sessions/cs_test_first/expire',
      'https://api.stripe.com/v1/checkout/sessions'
    ])
    expect((await fullAccessPurchase(testDb(), a.id))?.checkoutSessionId).toBe('cs_test_second')
    expect(new Headers(stripe.mock.calls[3][1]?.headers).get('idempotency-key')).toBe(
      `full-access/${a.id}/${T2}/cs_test_first`
    )
  })

  it('finds the payment on the next tap when ending a session fails because it was just paid', async () => {
    const a = await signUp('A')
    const justPaid = () =>
      Response.json({ error: { message: 'Only open sessions' } }, { status: 400 })
    stubStripe(sessionFor(a.id, T1), sessionFor(a.id, T1), justPaid(), paidSessionFor(a.id, T1))
    await checkout(T1, a)
    const failed = await checkout(T2, a)
    expect(failed.status).toBe(502)
    expect(await (await checkout(T2, a)).json()).toEqual({ active: true })
    expect(await counted('paid')).toBe(1)
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
    expect((await fullAccessPurchase(testDb(), a.id))?.checkoutSessionId).toBe('cs_test_second')
    // A new idempotency key, or Stripe would answer with the expired one.
    expect(new Headers(stripe.mock.calls[2][1]?.headers).get('idempotency-key')).toBe(
      `full-access/${a.id}/${T1}/cs_test_first`
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
    expect(await hasIt(a)).toBe(false)
    expect(await (await checkout(T1, a)).json()).toEqual({ url: next.url })
    expect((await fullAccessPurchase(testDb(), a.id))?.checkoutSessionId).toBe('cs_test_second')
  })

  it('has Full Access once Stripe says it’s paid, on the return, before the webhook', async () => {
    const a = await signUp('A')
    stubStripe(sessionFor(a.id, T1), sessionFor(a.id, T1), paidSessionFor(a.id, T1))
    await checkout(T1, a)
    expect(await hasIt(a)).toBe(false)
    expect((await save(T1, a)).status).toBe(402)
    expect(await hasIt(a)).toBe(true)
    expect((await fullAccessPurchase(testDb(), a.id))?.paymentIntent).toBe('pi_test_first')
    expect((await save(T1, a)).status).toBe(201)
    expect((await save(T2, a)).status).toBe(201)
  })

  it('never takes a session that charged anything but the price as paid', async () => {
    const a = await signUp('A')
    const paid = paidSessionFor(a.id, T1)
    stubStripe(sessionFor(a.id, T1), { ...paid, amount_total: 1 }, { ...paid, currency: 'eur' })
    await checkout(T1, a)
    expect(await hasIt(a)).toBe(false)
    expect(await hasIt(a)).toBe(false)
    for (const wrong of [{ amount_total: 0 }, { amount_total: null }, { currency: 'jpy' }]) {
      expect((await deliver(completed({ ...paid, ...wrong }))).status).toBe(200)
    }
    // The old price alone isn't this purchase's.
    expect((await deliver(completed({ ...paid, amount_total: 99 }))).status).toBe(200)
    expect((await fullAccessPurchase(testDb(), a.id))?.paidAt).toBeNull()
    expect((await save(T1, a)).status).toBe(402)
  })

  it('takes a payment in the buyer’s own currency (Adaptive Pricing): the session keeps 499 usd', async () => {
    const a = await signUp('A')
    stubStripe(sessionFor(a.id, T1))
    await checkout(T1, a)
    const local = paidSessionFor(a.id, T1, {
      presentment_details: { presentment_currency: 'jpy', presentment_amount: 820 }
    })
    expect((await deliver(completed(local))).status).toBe(200)
    expect(await hasIt(a)).toBe(true)
    expect((await save(T1, a)).status).toBe(201)
  })

  it('takes a session paid at the price its checkout started at, after the price changed', async () => {
    const a = await signUp('A')
    // The checkout started at 299, and the price has changed since.
    const before = { amount: 299, currency: 'usd' }
    expect(before.amount).not.toBe(FULL_ACCESS_PRICE.amount)
    await startFullAccess(testDb(), a.id, 'cs_test_first', before)
    const paidThen = paidSessionFor(a.id, T1, { amount_total: before.amount })
    const stripe = stubStripe(paidThen)
    expect(await (await checkout(T1, a)).json()).toEqual({ active: true })
    // Stripe was asked about that session, and no new one was made.
    expect(stripe.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api.stripe.com/v1/checkout/sessions/cs_test_first'
    ])
    expect((await save(T1, a)).status).toBe(201)

    // The webhook judges by the row's price too.
    const b = await signUp('B')
    await startFullAccess(testDb(), b.id, 'cs_test_second', before)
    const webhookPaid = paidSessionFor(b.id, T2, {
      id: 'cs_test_second',
      amount_total: before.amount
    })
    expect((await deliver(completed(webhookPaid))).status).toBe(200)
    expect(await hasIt(b)).toBe(true)
  })

  it('never starts a second payment when the last session is paid at another price', async () => {
    const a = await signUp('A')
    const stripe = stubStripe(sessionFor(a.id, T1), paidSessionFor(a.id, T1, { amount_total: 1 }))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await checkout(T1, a)
    const refused = await checkout(T1, a)
    expect(refused.status).toBe(409)
    expect(await refused.json()).toEqual({ error: 'payment_mismatch' })
    expect(stripe).toHaveBeenCalledTimes(2)
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({ event: 'stripe_paid_session_refused', session: 'cs_test_first' })
    )
    expect((await fullAccessPurchase(testDb(), a.id))?.paidAt).toBeNull()
  })

  it('answers the Sound Pad’s check on open from D1 alone, never asking Stripe (ADR 0017)', async () => {
    const a = await signUp('A')
    stubStripe(sessionFor(a.id, T1))
    await checkout(T1, a)
    vi.restoreAllMocks()
    const stripe = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => Response.json(paidSessionFor(a.id, T1)))
    const checksSpent = () =>
      env.DB.prepare('SELECT count FROM rate_limit WHERE key = ?')
        .bind(`stripeChecks|${a.id}`)
        .first<number>('count')
    // Paid at Stripe, but no webhook yet: the open reads none, and spends no Stripe check.
    for (let i = 0; i < 3; i++) {
      const opened = await access(a, '?check=stored')
      expect(await opened.json()).toEqual({ active: false, limitReached: false })
    }
    expect(stripe).not.toHaveBeenCalled()
    expect(await checksSpent()).toBeNull()
    // The return from Checkout still asks Stripe, which marks it paid in D1.
    expect(await hasIt(a)).toBe(true)
    expect(stripe).toHaveBeenCalledOnce()
    expect(await checksSpent()).toBe(1)
    // The next open reads that from D1.
    expect(await (await access(a, '?check=stored')).json()).toEqual({
      active: true,
      limitReached: false
    })
    expect(stripe).toHaveBeenCalledOnce()
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
    for (let i = 0; i < max; i++) expect(await hasIt(a)).toBe(false)
    expect(stripe).toHaveBeenCalledTimes(max)
    expect(await hasIt(a)).toBe(false)
    expect(stripe).toHaveBeenCalledTimes(max)

    // The webhook still marks it paid, and D1 says so.
    expect((await deliver(completed(paidSessionFor(a.id, T1)))).status).toBe(200)
    expect(await hasIt(a)).toBe(true)
    expect(stripe).toHaveBeenCalledTimes(max)
  })

  it('never asks Stripe with no purchase, or with Full Access', async () => {
    const a = await signUp('A')
    const stripe = vi.spyOn(globalThis, 'fetch')
    expect(await hasIt(a)).toBe(false)
    await pastPayment(a.id, T1)
    expect(await hasIt(a)).toBe(true)
    expect(await (await checkout(T2, a)).json()).toEqual({ active: true })
    expect(stripe).not.toHaveBeenCalled()
  })

  it('answers 502 when Stripe fails, and names nothing of it', async () => {
    const a = await signUp('A')
    stubStripe(Response.json({ error: { message: 'Invalid API Key' } }, { status: 401 }))
    const failed = await checkout(T1, a)
    expect(failed.status).toBe(502)
    expect(await failed.json()).toEqual({ error: 'payments_failed' })
    expect(await fullAccessPurchase(testDb(), a.id)).toBeNull()
  })

  it('gives Full Access from a signed paid event', async () => {
    const a = await signUp('A')
    stubStripe(sessionFor(a.id, T1))
    await checkout(T1, a)
    vi.restoreAllMocks()
    const stripe = vi.spyOn(globalThis, 'fetch')

    const event = completed(paidSessionFor(a.id, T1))
    const received = await deliver(event)
    expect(received.status).toBe(200)
    expect(received.headers.get('cache-control')).toBe('no-store')
    expect(await hasIt(a)).toBe(true)
    expect((await fullAccessPurchase(testDb(), a.id))?.paymentIntent).toBe('pi_test_first')
    expect((await save(T1, a)).status).toBe(201)
    // Stripe sends an event again until it's answered: a second delivery changes nothing.
    expect((await deliver(event)).status).toBe(200)
    expect(stripe).not.toHaveBeenCalled()
    expect(await counted('paid')).toBe(1)
  })

  it('takes a slower payment method’s success too', async () => {
    const a = await signUp('A')
    stubStripe(sessionFor(a.id, T1))
    await checkout(T1, a)
    const event = completed(paidSessionFor(a.id, T1), 'checkout.session.async_payment_succeeded')
    expect((await deliver(event)).status).toBe(200)
    expect((await fullAccessPurchase(testDb(), a.id))?.paidAt).toBeInstanceOf(Date)
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
    expect((await fullAccessPurchase(testDb(), a.id))?.paidAt).toBeNull()
  })

  it('changes nothing for an unpaid, live, mismatched or other event', async () => {
    const a = await signUp('A')
    const b = await signUp('B')
    const c = await signUp('C')
    stubStripe(sessionFor(a.id, T1))
    await checkout(T1, a)
    const paid = paidSessionFor(a.id, T1)
    const events = [
      completed(sessionFor(a.id, T1, { status: 'complete' })),
      completed({ ...paid, livemode: true }),
      { ...completed(paid), livemode: true },
      completed({ ...paid, metadata: { purchase: 'full_access', user_id: b.id, toot_id: T1 } }),
      completed({ ...paid, client_reference_id: b.id }),
      completed(paid, 'checkout.session.expired'),
      // An account that never started one has nothing to mark.
      completed(paidSessionFor(c.id, T2)),
      { type: 'customer.created', livemode: false, data: { object: { id: 'cus_test_1' } } }
    ]
    for (const event of events) expect((await deliver(event)).status).toBe(200)
    expect((await fullAccessPurchase(testDb(), a.id))?.paidAt).toBeNull()
    expect(await fullAccessPurchase(testDb(), b.id)).toBeNull()
    expect(await fullAccessPurchase(testDb(), c.id)).toBeNull()
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

  describe('refunds', () => {
    /** An account that has paid, through Checkout and its webhook. */
    async function buyer(name: string, paymentIntent = 'pi_test_first') {
      const user = await signUp(name)
      const started = stubStripe(sessionFor(user.id, T1))
      await checkout(T1, user)
      started.mockRestore()
      const session = paidSessionFor(user.id, T1, { payment_intent: paymentIntent })
      expect((await deliver(completed(session))).status).toBe(200)
      return user
    }

    it('ends Full Access on a full refund, and the saved Toots stay', async () => {
      const a = await buyer('A')
      expect((await save(T1, a)).status).toBe(201)
      expect(await hasIt(a)).toBe(true)

      const received = await deliver(refundedCharge())
      expect(received.status).toBe(200)
      expect(await hasIt(a)).toBe(false)
      expect((await fullAccessPurchase(testDb(), a.id))?.refundedAt).toBeInstanceOf(Date)
      expect(await tootRows(a.id)).toEqual([{ id: T1, deleted_at: null }])
      // Its row stays, so a retried upload of what's saved still answers kept.
      expect((await save(T1, a)).status).toBe(200)
      // The next new Toot asks again.
      expect(await (await save(T2, a)).json()).toEqual({ error: 'payment_required' })

      // Stripe sends an event again until it's answered: a second delivery changes nothing.
      const refundedAt = (await fullAccessPurchase(testDb(), a.id))?.refundedAt
      expect((await deliver(refundedCharge())).status).toBe(200)
      expect((await fullAccessPurchase(testDb(), a.id))?.refundedAt).toEqual(refundedAt)
    })

    it('changes nothing on a partial refund', async () => {
      const a = await buyer('A')
      expect((await deliver(refundedCharge({ refunded: false }))).status).toBe(200)
      expect(await hasIt(a)).toBe(true)
      expect((await fullAccessPurchase(testDb(), a.id))?.refundedAt).toBeNull()
    })

    it('changes nothing for another payment, a live event, or a forged one', async () => {
      const a = await buyer('A')
      const events = [
        refundedCharge({ payment_intent: 'pi_test_other' }),
        refundedCharge({}, true),
        { ...refundedCharge(), data: {} }
      ]
      for (const event of events) expect((await deliver(event)).status).toBe(200)
      const forged = await deliver(refundedCharge(), { secret: 'whsec_forgedByAnAttacker' })
      expect(forged.status).toBe(400)
      expect(await hasIt(a)).toBe(true)
    })

    it('ends only the Full Access that payment bought', async () => {
      const a = await buyer('A')
      const b = await buyer('B', 'pi_test_second')
      expect((await deliver(refundedCharge())).status).toBe(200)
      expect(await hasIt(a)).toBe(false)
      expect(await hasIt(b)).toBe(true)
    })

    it('lets someone refunded buy again, with a new session and nothing left of the old one', async () => {
      const a = await buyer('A')
      expect((await deliver(refundedCharge())).status).toBe(200)

      const next = sessionFor(a.id, T2, {
        id: 'cs_test_second',
        url: 'https://checkout.stripe.com/c/pay/cs_test_second'
      })
      const stripe = stubStripe(next)
      expect(await (await checkout(T2, a)).json()).toEqual({ url: next.url })
      // It never asks about the refunded session, and it doesn't reuse it.
      expect(stripe.mock.calls.map(([url]) => String(url))).toEqual([
        'https://api.stripe.com/v1/checkout/sessions'
      ])
      expect(new Headers(stripe.mock.calls[0][1]?.headers).get('idempotency-key')).toBe(
        `full-access/${a.id}/${T2}/cs_test_first`
      )
      expect(await fullAccessPurchase(testDb(), a.id)).toMatchObject({
        checkoutSessionId: 'cs_test_second',
        paymentIntent: null,
        paidAt: null,
        refundedAt: null
      })
      stripe.mockRestore()

      // The old refund arrives again: it isn't this purchase's.
      expect((await deliver(refundedCharge())).status).toBe(200)
      const paid = paidSessionFor(a.id, T2, {
        id: 'cs_test_second',
        payment_intent: 'pi_test_second'
      })
      expect((await deliver(completed(paid))).status).toBe(200)
      expect(await hasIt(a)).toBe(true)
      expect((await deliver(refundedCharge())).status).toBe(200)
      expect(await hasIt(a)).toBe(true)
      expect(await counted('paid')).toBe(2)
    })

    it('never gives it back from a paid event sent again after the refund', async () => {
      const a = await buyer('A')
      expect((await deliver(refundedCharge())).status).toBe(200)
      expect((await deliver(completed(paidSessionFor(a.id, T1)))).status).toBe(200)
      expect(await hasIt(a)).toBe(false)
    })

    it('ends what a 99¢ payment gave, by its metadata, leaving any other it paid', async () => {
      const a = await signUp('A')
      await pastPayment(a.id, T1)
      await pastPayment(a.id, T2)
      const oldCharge = (tootId: string) =>
        refundedCharge({
          payment_intent: `pi_test_old_${tootId}`,
          metadata: { user_id: a.id, toot_id: tootId }
        })
      expect((await deliver(oldCharge(T1))).status).toBe(200)
      expect((await tootPayment(testDb(), a.id, T1))?.refundedAt).toBeInstanceOf(Date)
      expect(await hasIt(a)).toBe(true)
      expect((await deliver(oldCharge(T2))).status).toBe(200)
      expect(await hasIt(a)).toBe(false)
    })

    it('leaves a 99¢ payment alone when the refund is of the $4.99', async () => {
      const a = await buyer('A')
      await pastPayment(a.id, T2)
      const charge = refundedCharge({ metadata: { purchase: 'full_access', user_id: a.id } })
      expect((await deliver(charge)).status).toBe(200)
      expect((await tootPayment(testDb(), a.id, T2))?.refundedAt).toBeNull()
      // That earlier payment still gives it.
      expect(await hasIt(a)).toBe(true)
    })
  })

  describe('a 99¢ session still open when Full Access came', () => {
    it('gives Full Access once it’s paid, by the webhook alone', async () => {
      const a = await signUp('A')
      await pastPayment(a.id, T1, { paidAt: null })
      const stripe = vi.spyOn(globalThis, 'fetch')
      expect(await hasIt(a)).toBe(false)
      const paid = oldSessionFor(a.id, T1, { status: 'complete', payment_status: 'paid' })
      expect((await deliver(completed(paid))).status).toBe(200)
      expect(await hasIt(a)).toBe(true)
      expect((await tootPayment(testDb(), a.id, T1))?.paidAt).toBeInstanceOf(Date)
      expect(await counted('paid')).toBe(1)
      // Sent again, it counts once.
      expect((await deliver(completed(paid))).status).toBe(200)
      expect(await counted('paid')).toBe(1)
      expect((await save(T1, a)).status).toBe(201)
      expect(stripe).not.toHaveBeenCalled()
    })

    it('counts only for its own Toot, its own user and the price it started at', async () => {
      const a = await signUp('A')
      const b = await signUp('B')
      await pastPayment(a.id, T1, { paidAt: null })
      const paid = { status: 'complete', payment_status: 'paid' } as const
      const events = [
        completed(oldSessionFor(a.id, T1, { ...paid, amount_total: 499 })),
        completed(oldSessionFor(a.id, T1, { ...paid, client_reference_id: T2 })),
        completed(oldSessionFor(a.id, T2, paid)),
        completed(oldSessionFor(b.id, T1, paid)),
        completed(oldSessionFor(a.id, T1))
      ]
      for (const event of events) expect((await deliver(event)).status).toBe(200)
      expect(await hasIt(a)).toBe(false)
      expect(await hasIt(b)).toBe(false)
    })
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
    const b = await signUp('B')
    await startFullAccess(testDb(), a.id, 'cs_live_first', FULL_ACCESS_PRICE)
    await startFullAccess(testDb(), b.id, 'cs_test_first', FULL_ACCESS_PRICE)
    const live = paidSessionFor(a.id, T1, { id: 'cs_live_first', livemode: true })
    const test = paidSessionFor(b.id, T2)
    const receive = async (livemode: boolean, event: unknown) => {
      const request = await eventRequest(event)
      return (await receiveStripeEvent({ db: testDb() }, payments(livemode), request)).status
    }

    expect(await receive(true, completed(test))).toBe(200)
    expect(await receive(false, completed(live))).toBe(200)
    expect((await fullAccessPurchase(testDb(), a.id))?.paidAt).toBeNull()
    expect((await fullAccessPurchase(testDb(), b.id))?.paidAt).toBeNull()

    expect(await receive(true, completed(live))).toBe(200)
    expect(await receive(false, completed(test))).toBe(200)
    expect((await fullAccessPurchase(testDb(), a.id))?.paidAt).toBeInstanceOf(Date)
    expect((await fullAccessPurchase(testDb(), b.id))?.paidAt).toBeInstanceOf(Date)
  })

  it('takes a refund only from an event of its own mode', async () => {
    const a = await signUp('A')
    await startFullAccess(testDb(), a.id, 'cs_live_first', FULL_ACCESS_PRICE)
    const live = paidSessionFor(a.id, T1, { id: 'cs_live_first', livemode: true })
    const receive = async (livemode: boolean, event: unknown) => {
      const request = await eventRequest(event)
      return (await receiveStripeEvent({ db: testDb() }, payments(livemode), request)).status
    }
    expect(await receive(true, completed(live))).toBe(200)
    expect(await receive(true, refundedCharge({}, false))).toBe(200)
    expect((await fullAccessPurchase(testDb(), a.id))?.refundedAt).toBeNull()
    expect(await receive(true, refundedCharge({}, true))).toBe(200)
    expect((await fullAccessPurchase(testDb(), a.id))?.refundedAt).toBeInstanceOf(Date)
  })
})

describe('with saving free', () => {
  // No environment saves free today, but a page loaded before a rollback to free saving still asks
  // to pay, and needs `{ active: true }` from both to save.
  it('answers active to checkout and the check, with no purchase and no Stripe', async () => {
    const a = await signUp('A')
    const stripe = vi.spyOn(globalThis, 'fetch')
    const free: Payments = { kind: 'free' }
    const started = await startCheckout(
      { db: testDb() },
      free,
      a,
      checkoutRequest(a, { tootId: T1, songId: 'twinkle' })
    )
    expect(await started.json()).toEqual({ active: true })
    const check = await getFullAccess({ db: testDb() }, free, a, accessRequest(a))
    expect(await check.json()).toEqual({ active: true, limitReached: false })
    expect(await fullAccessPurchase(testDb(), a.id)).toBeNull()
    expect(stripe).not.toHaveBeenCalled()
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

describe('on Production, where saving is paid too (#258)', () => {
  beforeEach(() => {
    extraEnv.SITE_ENV = 'production'
  })

  const liveSession = (userId: string, tootId: string, fields: Partial<CheckoutSession> = {}) =>
    sessionFor(userId, tootId, {
      id: 'cs_live_first',
      url: 'https://checkout.stripe.com/c/pay/cs_live_first',
      livemode: true,
      ...fields
    })

  it('pays through Stripe in live mode, with no dev checkout, and saves once paid', async () => {
    extraEnv.STRIPE_SECRET_KEY = LIVE_KEY
    const a = await signUp('A')
    expect(await (await save(T1, a)).json()).toEqual({ error: 'payment_required' })
    const stripe = stubStripe(
      liveSession(a.id, T1),
      liveSession(a.id, T1, { status: 'complete', payment_status: 'paid' })
    )
    expect(await (await checkout(T1, a)).json()).toEqual({
      url: 'https://checkout.stripe.com/c/pay/cs_live_first'
    })
    expect(new Headers(stripe.mock.calls[0][1]?.headers).get('authorization')).toBe(
      `Bearer ${LIVE_KEY}`
    )
    expect((await payDev(T1, a)).status).toBe(404)
    expect(devCheckoutServes(HOST)).toBe(false)
    expect((await save(T1, a)).status).toBe(402)

    // Back from Checkout, Stripe says it's paid, and the Toot saves.
    expect(await hasIt(a)).toBe(true)
    expect((await save(T1, a)).status).toBe(201)
    expect(stripe).toHaveBeenCalledTimes(2)
  })

  it('gives Full Access from a signed live event, never from a test one', async () => {
    extraEnv.STRIPE_SECRET_KEY = LIVE_KEY
    extraEnv.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET
    const a = await signUp('A')
    await startFullAccess(testDb(), a.id, 'cs_live_first', FULL_ACCESS_PRICE)
    const session = liveSession(a.id, T1, { status: 'complete', payment_status: 'paid' })
    expect((await deliver(completed({ ...session, livemode: false }))).status).toBe(200)
    expect((await fullAccessPurchase(testDb(), a.id))?.paidAt).toBeNull()
    expect((await deliver(completed(session))).status).toBe(200)
    expect((await fullAccessPurchase(testDb(), a.id))?.paidAt).toBeInstanceOf(Date)
    expect((await save(T1, a)).status).toBe(201)
  })

  it('takes no payment without a live key, and never stands in for Checkout', async () => {
    const a = await signUp('A')
    const stripe = vi.spyOn(globalThis, 'fetch')
    for (const key of [undefined, TEST_KEY, 'rk_test_madeUpForTheTests']) {
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
