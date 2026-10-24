import { savingIsPaid, TOOT_PRICE } from '@/lib/pricing'

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
 * - `free`: Production, until it has Stripe's live keys. Saving needs no payment.
 * - `stripe`: Stripe Checkout in test mode. `webhookSecret` is null until it is set.
 * - `dev`: a local run on a local host with no Stripe key: `/dev/checkout/` stands in for
 *   Checkout, for the e2e journeys and tap-throughs.
 * - `off`: saving needs a payment, and none can be taken: no key, a live key (test mode only, for
 *   now), or a misconfigured `SITE_ENV`. Checkout answers 503.
 */
export type Payments =
  | { kind: 'free' }
  | { kind: 'stripe'; secretKey: string; webhookSecret: string | null }
  | { kind: 'dev' }
  | { kind: 'off' }

const TEST_KEY = /^(sk|rk)_test_[A-Za-z0-9]+$/
const WEBHOOK_SECRET = /^whsec_[A-Za-z0-9+/=]+$/

/** Payments for a request to `host` (the `Host` header, port included). */
export function paymentsConfig(env: PaymentsEnv, host: string | null): Payments {
  const target = deployment(env)
  if (target.kind === 'misconfigured') return { kind: 'off' }
  if (target.kind === 'deployed' && !savingIsPaid(target.name)) return { kind: 'free' }
  const key = env.STRIPE_SECRET_KEY
  if (typeof key === 'string' && TEST_KEY.test(key)) {
    const secret = env.STRIPE_WEBHOOK_SECRET
    const webhookSecret = typeof secret === 'string' && WEBHOOK_SECRET.test(secret) ? secret : null
    return { kind: 'stripe', secretKey: key, webhookSecret }
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
}

const STRIPE_API = 'https://api.stripe.com/v1'
const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]+$/

/** Whether `id` is a Stripe Checkout Session's id, safe to put in a request's path. */
export function isCheckoutSessionId(id: string): boolean {
  return SESSION_ID.test(id)
}

async function stripeRequest(
  secretKey: string,
  path: string,
  body?: URLSearchParams
): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`${STRIPE_API}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        ...(body && { 'Content-Type': 'application/x-www-form-urlencoded' })
      },
      body
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
}

/**
 * Starts a Checkout Session that pays `TOOT_PRICE` to save one Toot. Its metadata names the user
 * and the Toot, which is how the webhook and the return find what was paid for. Checkout shows
 * the payment methods the Stripe account has on, Apple Pay and Google Pay among them.
 */
export async function createCheckoutSession(
  secretKey: string,
  checkout: NewCheckout
): Promise<CheckoutSession> {
  const params = new URLSearchParams({
    mode: 'payment',
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
  return (await stripeRequest(secretKey, '/checkout/sessions', params)) as CheckoutSession
}

/** A Checkout Session, as Stripe has it now. */
export async function retrieveCheckoutSession(
  secretKey: string,
  id: string
): Promise<CheckoutSession> {
  if (!isCheckoutSessionId(id)) throw new StripeError(400)
  return (await stripeRequest(secretKey, `/checkout/sessions/${id}`)) as CheckoutSession
}

/** Whether Stripe says `session` paid for `tootId`, for `userId`. */
export function paidFor(session: CheckoutSession, userId: string, tootId: string): boolean {
  return (
    session.mode === 'payment' &&
    session.payment_status === 'paid' &&
    session.client_reference_id === tootId &&
    session.metadata?.toot_id === tootId &&
    session.metadata?.user_id === userId
  )
}

/** How far a webhook's timestamp may be from now, in seconds: Stripe's own default. */
export const SIGNATURE_TOLERANCE_SECONDS = 300

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
  if (timestamp === null || !/^\d{1,12}$/.test(timestamp) || signatures.length === 0) return false
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
