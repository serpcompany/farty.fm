import { getCloudflareContext } from '@opennextjs/cloudflare'

import { uploadState } from '@/db/library'
import { markTootPaid, startTootPayment, tootPayment } from '@/db/payments'
import { songs } from '@/lib/catalog/songs.generated'
import { TOOT_PRICE } from '@/lib/pricing'
import { servedOrigin } from '@/lib/site'

import { LIMITS, type Stores, wrongLibrary } from './library'
import { isItemId, readCapped, readJson } from './library-input'
import { apiError, type SessionUser } from './require-user'
import {
  type CheckoutSession,
  createCheckoutSession,
  isCheckoutSessionId,
  type Payments,
  paidFor,
  paymentsConfig,
  retrieveCheckoutSession,
  StripeError,
  verifyStripeSignature
} from './stripe'

// Paying to save a Toot (ADR 0010), given this request's database and payments. The routes build
// the first three with `userRoute`; Stripe's webhook has no session and is checked by its
// signature instead. `putItem` refuses a Toot that isn't paid for (402 `payment_required`).

/** This request's payments, from the Worker's env and the request's host. */
export function requestPayments(request: Request): Payments {
  return paymentsConfig(getCloudflareContext().env, request.headers.get('host'))
}

const notFound = () => apiError(404, 'not_found')
const unavailable = () => apiError(503, 'payments_unavailable')
const paid = () => Response.json({ paid: true })

/** A Stripe request failed: logged by its status alone, and answered 502. */
function stripeFailed(error: unknown): Response {
  if (!(error instanceof StripeError)) throw error
  console.error(JSON.stringify({ event: 'stripe_request_failed', status: error.status }))
  return apiError(502, 'payments_failed')
}

/** The Song of `songId`, from the catalog, or null. */
function catalogSong(songId: unknown) {
  return songs.find(song => song.id === songId) ?? null
}

/** Where Checkout comes back to: the Song's Song Creator, which makes the same Toot again. */
function songCreatorUrl(request: Request, songId: string, tootId: string, done: boolean): string {
  const url = new URL(`/compose/${songId}/`, servedOrigin(request))
  url.searchParams.set('toot', tootId)
  if (done) url.searchParams.set('checkout', 'done')
  return url.toString()
}

/**
 * Asks Stripe about the Toot's latest Checkout Session, and records it paid if it is. Null when
 * Stripe no longer has it (deleted test data, or another Stripe account's key), so a new one starts.
 */
async function paidAtStripe(
  { db }: Pick<Stores, 'db'>,
  secretKey: string,
  user: SessionUser,
  tootId: string,
  checkoutSessionId: string
): Promise<{ paid: boolean; session: CheckoutSession } | null> {
  let session: CheckoutSession
  try {
    session = await retrieveCheckoutSession(secretKey, checkoutSessionId)
  } catch (error) {
    if (error instanceof StripeError && error.status === 404) return null
    throw error
  }
  if (!paidFor(session, user.id, tootId)) return { paid: false, session }
  return { paid: await markTootPaid(db, user.id, tootId, session.id), session }
}

/**
 * `POST /api/toots/{id}/checkout/` with `{ songId }`: where to pay to save the Toot. `{ url }`,
 * Stripe Checkout's page (or `/dev/checkout/` on a local run), or `{ paid: true }` when there's
 * nothing to pay: it's paid already, it's saved, or saving is free here. An open Checkout Session
 * for the same Toot is reused, so two taps or two tabs can't pay twice. 410 if the Toot was
 * deleted, 409 at the Toot limit (before anything is paid), 503 when payments aren't set up here.
 */
export async function startCheckout(
  { db }: Pick<Stores, 'db'>,
  payments: Payments,
  user: SessionUser,
  id: string,
  request: Request
): Promise<Response> {
  if (!isItemId(id)) return notFound()
  const wrong = wrongLibrary(user, request)
  if (wrong) return wrong
  if (payments.kind === 'free') return paid()
  if (payments.kind === 'off') return unavailable()
  const body = await readJson(request)
  if (body instanceof Response) return body
  const song = catalogSong((body.json as { songId?: unknown } | null)?.songId)
  if (!song) return apiError(400, 'invalid_request')

  const saved = await uploadState(db, 'toots', user.id, id)
  if (saved.status === 'live') return paid()
  if (saved.status === 'deleted') return apiError(410, 'deleted')
  const payment = await tootPayment(db, user.id, id)
  if (payment?.paidAt) return paid()
  if (saved.live >= LIMITS.toots.maxItems) return apiError(409, 'limit_reached')

  if (payments.kind === 'dev') {
    const sessionId = payment?.checkoutSessionId.startsWith('dev_')
      ? payment.checkoutSessionId
      : `dev_${crypto.randomUUID()}`
    await startTootPayment(db, user.id, id, sessionId, TOOT_PRICE)
    const url = new URL('/dev/checkout/', servedOrigin(request))
    url.searchParams.set('toot', id)
    url.searchParams.set('song', song.id)
    return Response.json({ url: url.toString() })
  }

  try {
    if (payment && isCheckoutSessionId(payment.checkoutSessionId)) {
      const earlier = await paidAtStripe(
        { db },
        payments.secretKey,
        user,
        id,
        payment.checkoutSessionId
      )
      if (earlier?.paid) return paid()
      if (earlier?.session.status === 'open' && earlier.session.url) {
        return Response.json({ url: earlier.session.url })
      }
    }
    const session = await createCheckoutSession(payments.secretKey, {
      userId: user.id,
      tootId: id,
      songTitle: song.title,
      successUrl: songCreatorUrl(request, song.id, id, true),
      cancelUrl: songCreatorUrl(request, song.id, id, false)
    })
    if (!session.url) throw new StripeError(502)
    await startTootPayment(db, user.id, id, session.id, TOOT_PRICE)
    return Response.json({ url: session.url })
  } catch (error) {
    return stripeFailed(error)
  }
}

/**
 * `GET /api/toots/{id}/payment/`: `{ paid }`, whether the Toot is paid for. Unpaid with a Stripe
 * Checkout Session, it asks Stripe, so the return from Checkout doesn't wait for the webhook.
 */
export async function getTootPayment(
  { db }: Pick<Stores, 'db'>,
  payments: Payments,
  user: SessionUser,
  id: string,
  request: Request
): Promise<Response> {
  if (!isItemId(id)) return notFound()
  const wrong = wrongLibrary(user, request)
  if (wrong) return wrong
  if (payments.kind === 'free') return paid()
  const payment = await tootPayment(db, user.id, id)
  if (payment?.paidAt) return paid()
  if (payment && payments.kind === 'stripe' && isCheckoutSessionId(payment.checkoutSessionId)) {
    try {
      const now = await paidAtStripe(
        { db },
        payments.secretKey,
        user,
        id,
        payment.checkoutSessionId
      )
      return Response.json({ paid: now?.paid ?? false })
    } catch (error) {
      return stripeFailed(error)
    }
  }
  return Response.json({ paid: false })
}

/** The events that say a Checkout Session is paid: by card or wallet, or by a slower method. */
const PAID_EVENTS = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded'
])
/** Stripe's events are a few KB; anything far larger isn't one. */
const WEBHOOK_MAX_BYTES = 256 * 1024
const USER_ID = /^[A-Za-z0-9_-]{1,128}$/

/**
 * `POST /api/stripe/webhook/`: Stripe's events, signed with the endpoint's secret. A paid Checkout
 * Session for a Toot marks it paid. Every other signed event answers 200 and changes nothing, so
 * Stripe doesn't retry it. 400 for a missing, wrong or stale signature; 503 when the webhook's
 * secret isn't set here.
 */
export async function receiveStripeEvent(
  { db }: Pick<Stores, 'db'>,
  payments: Payments,
  request: Request,
  nowSeconds = Date.now() / 1000
): Promise<Response> {
  if (payments.kind !== 'stripe' || !payments.webhookSecret) return unavailable()
  const signature = request.headers.get('stripe-signature')
  if (!signature) return apiError(400, 'invalid_signature')
  const body = await readCapped(request, WEBHOOK_MAX_BYTES)
  if (body === null) return apiError(413, 'too_large')
  if (!(await verifyStripeSignature(body, signature, payments.webhookSecret, nowSeconds))) {
    return apiError(400, 'invalid_signature')
  }
  let event: { type?: unknown; livemode?: unknown; data?: { object?: unknown } }
  try {
    event = JSON.parse(new TextDecoder().decode(body))
  } catch {
    return apiError(400, 'invalid_request')
  }
  // Test mode only, as `paymentsConfig` takes only test keys (ADR 0010).
  if (typeof event.type === 'string' && PAID_EVENTS.has(event.type) && event.livemode === false) {
    const session = event.data?.object as CheckoutSession | undefined
    const userId = session?.metadata?.user_id
    const tootId = session?.metadata?.toot_id
    if (
      session &&
      typeof userId === 'string' &&
      USER_ID.test(userId) &&
      isItemId(tootId) &&
      paidFor(session, userId, tootId)
    ) {
      await markTootPaid(db, userId, tootId, session.id)
    }
  }
  return Response.json({ received: true })
}

/**
 * `POST /api/dev/checkout/`, a form with `toot` and `song`: the dev checkout's Pay. It marks the
 * Toot's dev payment paid and goes back to Song Creator, as Stripe's success URL would. 404
 * anywhere but a local run on a local host with no Stripe key.
 */
export async function payDevCheckout(
  { db }: Pick<Stores, 'db'>,
  payments: Payments,
  user: SessionUser,
  request: Request
): Promise<Response> {
  if (payments.kind !== 'dev') return notFound()
  const body = await readCapped(request, 4 * 1024)
  if (body === null) return apiError(413, 'too_large')
  const form = new URLSearchParams(new TextDecoder().decode(body))
  const tootId = form.get('toot')
  const song = catalogSong(form.get('song'))
  if (!isItemId(tootId) || !song) return apiError(400, 'invalid_request')
  const payment = await tootPayment(db, user.id, tootId)
  if (!payment?.checkoutSessionId.startsWith('dev_')) return notFound()
  await markTootPaid(db, user.id, tootId, payment.checkoutSessionId)
  return new Response(null, {
    status: 303,
    headers: { Location: songCreatorUrl(request, song.id, tootId, true) }
  })
}

/** Whether `/dev/checkout/` serves here: a local run on a local host with no Stripe key. */
export function devCheckoutServes(host: string | null): boolean {
  return paymentsConfig(getCloudflareContext().env, host).kind === 'dev'
}
