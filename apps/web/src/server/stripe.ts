import { builtFor, savingIsPaid, TOOT_PRICE } from '@/lib/pricing'

import type { SiteEnv } from '@/lib/site'

import { type DeploymentEnv, deployment, isLocalHost } from './environment'

// Stripe, for paying to save a Toot (ADR 0010): Checkout Sessions through Stripe's API with
// `fetch`, and webhook signatures with Web Crypto, so no Stripe SDK. No Next.js imports, so the
// unit tests run it in Node. A secret key never leaves this file, and no error names one.

/** What payments read from the Worker's env. Both are Worker secrets, never `vars`. */
export type PaymentsEnv = DeploymentEnv & {
  STRIPE_SECRET_KEY?: unknown
  STRIPE_WEBHOOK_SECRET?: unknown
}

/**
 * How saving a Toot is paid for here:
 *
 * - `free`: where `savingIsPaid` says saving is free. Saving needs no payment. Nowhere since #258,
 *   and kept so that making saving free again is a change to `pricing.ts` alone.
 * - `stripe`: Stripe Checkout, live on Production and in test mode everywhere else (`livemode`).
 *   `webhookSecret` is null until it is set.
 * - `dev`: a local run on a local host with no Stripe key: `/dev/checkout/` stands in for
 *   Checkout, for the e2e journeys and tap-throughs.
 * - `off`: saving needs a payment, and none can be taken: no key, a key of the other mode, or a
 *   misconfigured `SITE_ENV`. Checkout answers 503.
 */
export type Payments =
  | { kind: 'free' }
  | { kind: 'stripe'; secretKey: string; webhookSecret: string | null; livemode: boolean }
  | { kind: 'dev' }
  | { kind: 'off' }

const TEST_KEY = /^(sk|rk)_test_[A-Za-z0-9]+$/
const LIVE_KEY = /^(sk|rk)_live_[A-Za-z0-9]+$/
const WEBHOOK_SECRET = /^whsec_[A-Za-z0-9+/=]+$/

/**
 * Payments for a request to `host` (the `Host` header, port included). Production takes only live
 * keys, and Staging and local runs only test keys, so a test key can't take real payments and a
 * live key can't be used outside Production. Where saving is paid is `savingIsPaid` (`paid`, which
 * the tests replace): everywhere, Production included (#258).
 */
export function paymentsConfig(
  env: PaymentsEnv,
  host: string | null,
  paid: (environment: SiteEnv) => boolean = savingIsPaid
): Payments {
  const target = deployment(env)
  if (target.kind === 'misconfigured') return { kind: 'off' }
  // A local run goes by the environment its build is for, as the browser's Save does.
  if (!paid(target.kind === 'deployed' ? target.name : builtFor())) return { kind: 'free' }
  const livemode = target.kind === 'deployed' && target.name === 'production'
  const key = env.STRIPE_SECRET_KEY
  if (typeof key === 'string' && (livemode ? LIVE_KEY : TEST_KEY).test(key)) {
    const secret = env.STRIPE_WEBHOOK_SECRET
    const webhookSecret = typeof secret === 'string' && WEBHOOK_SECRET.test(secret) ? secret : null
    return { kind: 'stripe', secretKey: key, webhookSecret, livemode }
  }
  if (key === undefined && target.kind === 'local' && isLocalHost(host)) return { kind: 'dev' }
  return { kind: 'off' }
}

/** A Stripe request that failed. It keeps only the status, never Stripe's answer. */
export class StripeError extends Error {
  constructor(readonly status: number) {
    super(`Stripe answered ${status}`)
    this.name = 'StripeError'
  }
}

/** The fields Farty reads of a Checkout Session. */
export type CheckoutSession = {
  id: string
  url: string | null
  mode: string
  status: 'open' | 'complete' | 'expired' | null
  payment_status: 'paid' | 'unpaid' | 'no_payment_required'
  client_reference_id: string | null
  metadata: Record<string, string> | null
  livemode: boolean
  /**
   * What it charges, in the currency's smallest unit: the price it was created with. Adaptive
   * Pricing doesn't change these; what the buyer paid in their own currency is in
   * `presentment_details`, which Farty doesn't read.
   */
  amount_total: number | null
  currency: string | null
  presentment_details?: { presentment_amount: number; presentment_currency: string } | null
}

const STRIPE_API = 'https://api.stripe.com/v1'
/**
 * The Stripe API version every request is made with, so Stripe's answers don't change when the
 * account's default version does. The newer `2026-09-30.endive` refuses `payment_method_types` on
 * a Checkout Session, which `createCheckoutSession` sends.
 */
export const STRIPE_API_VERSION = '2026-08-26.dahlia'
const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]+$/

/** Whether `id` is a Stripe Checkout Session's id, safe to put in a request's path. */
export function isCheckoutSessionId(id: string): boolean {
  return SESSION_ID.test(id)
}

/**
 * One request to Stripe's API. A POST sends `idempotencyKey`, so a retried or doubled request makes
 * one object, not two.
 */
async function stripeRequest(
  secretKey: string,
  path: string,
  post?: { body: URLSearchParams; idempotencyKey: string }
): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`${STRIPE_API}${path}`, {
      method: post ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Stripe-Version': STRIPE_API_VERSION,
        ...(post && {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Idempotency-Key': post.idempotencyKey
        })
      },
      body: post?.body
    })
  } catch {
    throw new StripeError(0)
  }
  if (!response.ok) {
    await response.body?.cancel()
    throw new StripeError(response.status)
  }
  return response.json()
}

export type NewCheckout = {
  userId: string
  tootId: string
  songTitle: string
  successUrl: string
  cancelUrl: string
  /** The session this one follows for the Toot, if any: it expired, or Stripe no longer has it. */
  replaces: string | null
}

/**
 * Starts a Checkout Session that pays `TOOT_PRICE` to save one Toot. Its metadata names the user
 * and the Toot, which is how the webhook and the return find what was paid for. Cards only, with
 * Apple Pay and Google Pay, which pay at once: a slower method would leave the Toot unsaved after
 * the return, and Save would start a second payment.
 *
 * Its idempotency key names the user, the Toot and the session it replaces, so two requests that
 * cross, or a retry, get the same session from Stripe instead of a second one to pay.
 */
export async function createCheckoutSession(
  secretKey: string,
  checkout: NewCheckout
): Promise<CheckoutSession> {
  const params = new URLSearchParams({
    mode: 'payment',
    'payment_method_types[0]': 'card',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': TOOT_PRICE.currency,
    'line_items[0][price_data][unit_amount]': String(TOOT_PRICE.amount),
    'line_items[0][price_data][product_data][name]': `Save your Toot of ${checkout.songTitle}`,
    client_reference_id: checkout.tootId,
    'metadata[user_id]': checkout.userId,
    'metadata[toot_id]': checkout.tootId,
    'payment_intent_data[metadata][user_id]': checkout.userId,
    'payment_intent_data[metadata][toot_id]': checkout.tootId,
    success_url: checkout.successUrl,
    cancel_url: checkout.cancelUrl
  })
  const idempotencyKey = `toot-checkout/${checkout.userId}/${checkout.tootId}/${checkout.replaces ?? 'first'}`
  return (await stripeRequest(secretKey, '/checkout/sessions', {
    body: params,
    idempotencyKey
  })) as CheckoutSession
}

/** A Checkout Session, as Stripe has it now. */
export async function retrieveCheckoutSession(
  secretKey: string,
  id: string
): Promise<CheckoutSession> {
  if (!isCheckoutSessionId(id)) throw new StripeError(400)
  return (await stripeRequest(secretKey, `/checkout/sessions/${id}`)) as CheckoutSession
}

/** The price a Toot's checkout started at, as its payment row keeps it (`startTootPayment`). */
export type Price = { amount: number; currency: string }

/**
 * Whether Stripe says `session` paid `price` for `tootId`, for `userId`. `price` is the one the
 * Toot's payment row recorded when its checkout started, not today's `TOOT_PRICE`, so a session
 * paid before the price changed still counts.
 */
export function paidFor(
  session: CheckoutSession,
  userId: string,
  tootId: string,
  price: Price
): boolean {
  return (
    session.mode === 'payment' &&
    session.payment_status === 'paid' &&
    session.amount_total === price.amount &&
    session.currency === price.currency &&
    session.client_reference_id === tootId &&
    session.metadata?.toot_id === tootId &&
    session.metadata?.user_id === userId
  )
}

/** How far a webhook's timestamp may be from now, in seconds: Stripe's own default. */
export const SIGNATURE_TOLERANCE_SECONDS = 300
/** Stripe sends two `v1` while a secret is rolled. More than this, and it isn't Stripe. */
const MAX_SIGNATURES = 4

function hexBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^(?:[0-9a-f]{2})+$/.test(hex)) return null
  return Uint8Array.from(hex.match(/../g) ?? [], byte => Number.parseInt(byte, 16))
}

/**
 * Whether `payload` (the body's exact bytes) came from Stripe, signed with `secret`, the
 * endpoint's `whsec_…`: `Stripe-Signature: t=<seconds>,v1=<hex>` holds an HMAC-SHA256 of
 * `<t>.<payload>`. Any `v1` may match, since Stripe signs with both secrets while one is rolled.
 * A timestamp further than `SIGNATURE_TOLERANCE_SECONDS` from `nowSeconds` fails, so a captured
 * event can't be replayed later.
 */
export async function verifyStripeSignature(
  payload: Uint8Array,
  header: string | null,
  secret: string,
  nowSeconds: number
): Promise<boolean> {
  if (!header) return false
  let timestamp: string | null = null
  const signatures: Uint8Array<ArrayBuffer>[] = []
  for (const part of header.split(',')) {
    const separator = part.indexOf('=')
    const name = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    if (name === 't') timestamp = value
    if (name === 'v1') {
      const bytes = hexBytes(value)
      if (bytes) signatures.push(bytes)
    }
  }
  if (timestamp === null || !/^\d{1,12}$/.test(timestamp)) return false
  if (signatures.length === 0 || signatures.length > MAX_SIGNATURES) return false
  if (Math.abs(nowSeconds - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return false
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  )
  const prefix = encoder.encode(`${timestamp}.`)
  const signed = new Uint8Array(prefix.byteLength + payload.byteLength)
  signed.set(prefix)
  signed.set(payload, prefix.byteLength)
  for (const signature of signatures) {
    // `verify` compares in constant time.
    if (await crypto.subtle.verify('HMAC', key, signature, signed)) return true
  }
  return false
}
