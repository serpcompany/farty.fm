import { z } from 'zod'

import { builtFor, savingIsPaid, TOOT_PRICE } from '@/lib/pricing'
import type { SiteEnv } from '@/lib/site'

import { type DeploymentEnv, deployment, isLocalHost } from './environment'
import { hmacKey } from './hmac'

type PaymentsEnv = DeploymentEnv & {
  STRIPE_SECRET_KEY?: unknown
  STRIPE_WEBHOOK_SECRET?: unknown
}

export type Payments =
  | { kind: 'free' }
  | { kind: 'stripe'; secretKey: string; webhookSecret: string | null; livemode: boolean }
  | { kind: 'dev' }
  | { kind: 'off' }

const TEST_KEY = /^(sk|rk)_test_[A-Za-z0-9]+$/
const LIVE_KEY = /^(sk|rk)_live_[A-Za-z0-9]+$/
const WEBHOOK_SECRET = /^whsec_[A-Za-z0-9+/=]+$/

export function paymentsConfig(
  env: PaymentsEnv,
  host: string | null,
  paid: (environment: SiteEnv) => boolean = savingIsPaid
): Payments {
  const target = deployment(env)
  if (target.kind === 'misconfigured') return { kind: 'off' }
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

export class StripeError extends Error {
  constructor(readonly status: number) {
    super(`Stripe answered ${status}`)
    this.name = 'StripeError'
  }
}

export const CHECKOUT_SESSION = z.object({
  id: z.string(),
  url: z.string().nullable(),
  mode: z.string(),
  status: z.enum(['open', 'complete', 'expired']).nullable(),
  payment_status: z.enum(['paid', 'unpaid', 'no_payment_required']),
  client_reference_id: z.string().nullable(),
  metadata: z.record(z.string(), z.string()).nullable(),
  livemode: z.boolean(),
  amount_total: z.number().nullable(),
  currency: z.string().nullable()
})

export type CheckoutSession = z.infer<typeof CHECKOUT_SESSION>

const STRIPE_API = 'https://api.stripe.com/v1'
export const STRIPE_API_VERSION = '2026-08-26.dahlia'
const STRIPE_TIMEOUT_MS = 10_000
const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]+$/

export function isCheckoutSessionId(id: string): boolean {
  return SESSION_ID.test(id)
}

type StripePost = { body: URLSearchParams; idempotencyKey: string }

async function stripeResponse(
  secretKey: string,
  path: string,
  post?: StripePost
): Promise<Response> {
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
      body: post?.body,
      signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS)
    })
  } catch {
    throw new StripeError(0)
  }
  if (!response.ok) {
    await response.body?.cancel()
    throw new StripeError(response.status)
  }
  return response
}

async function checkoutSessionRequest(
  secretKey: string,
  path: string,
  post?: StripePost
): Promise<CheckoutSession> {
  const response = await stripeResponse(secretKey, path, post)
  const session = CHECKOUT_SESSION.safeParse(await response.json().catch(() => null))
  if (!session.success) throw new StripeError(502)
  return session.data
}

type NewCheckout = {
  userId: string
  tootId: string
  songTitle: string
  successUrl: string
  cancelUrl: string
  replaces: string | null
}

export function createCheckoutSession(
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
  return checkoutSessionRequest(secretKey, '/checkout/sessions', { body: params, idempotencyKey })
}

export async function retrieveCheckoutSession(
  secretKey: string,
  id: string
): Promise<CheckoutSession> {
  if (!isCheckoutSessionId(id)) throw new StripeError(400)
  return checkoutSessionRequest(secretKey, `/checkout/sessions/${id}`)
}

type Price = { amount: number; currency: string }

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

export const SIGNATURE_TOLERANCE_SECONDS = 300
const MAX_SIGNATURES = 4

function hexBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^(?:[0-9a-f]{2})+$/.test(hex)) return null
  return Uint8Array.from(hex.match(/../g) ?? [], byte => Number.parseInt(byte, 16))
}

function parseSignatureHeader(header: string) {
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
  return { timestamp, signatures }
}

export async function verifyStripeSignature(
  payload: Uint8Array,
  header: string | null,
  secret: string,
  nowSeconds: number
): Promise<boolean> {
  if (!header) return false
  const { timestamp, signatures } = parseSignatureHeader(header)
  if (timestamp === null || !/^\d{1,12}$/.test(timestamp)) return false
  if (signatures.length === 0 || signatures.length > MAX_SIGNATURES) return false
  if (Math.abs(nowSeconds - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return false
  const key = await hmacKey(secret, 'verify')
  const prefix = new TextEncoder().encode(`${timestamp}.`)
  const signed = new Uint8Array(prefix.byteLength + payload.byteLength)
  signed.set(prefix)
  signed.set(payload, prefix.byteLength)
  for (const signature of signatures) {
    if (await crypto.subtle.verify('HMAC', key, signature, signed)) return true
  }
  return false
}
