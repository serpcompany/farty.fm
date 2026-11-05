import { getCloudflareContext } from '@opennextjs/cloudflare'

import { liveItems, uploadState } from '@/db/library'
import {
  type FullAccessRow,
  fullAccessPurchase,
  hasFullAccess,
  markFullAccessPaid,
  markTootPaid,
  refundFullAccess,
  refundTootPayment,
  startFullAccess,
  tootPayment
} from '@/db/payments'
import { countStep } from '@/db/step-counts'
import { songIndex } from '@/lib/catalog/song-index.generated'
import { FULL_ACCESS_PRICE } from '@/lib/pricing'
import { servedOrigin } from '@/lib/site'

import { consumeSlot, type SlotRule } from './auth-config'
import { LIMITS, type Stores, wrongLibrary } from './library'
import { isItemId, readCapped, readJson } from './library-input'
import { apiError, type SessionUser } from './require-user'
import {
  type CheckoutSession,
  createCheckoutSession,
  expireCheckoutSession,
  FULL_ACCESS_PURCHASE,
  isCheckoutSessionId,
  type Payments,
  paidForFullAccess,
  paidForToot,
  paymentsConfig,
  retrieveCheckoutSession,
  StripeError,
  verifyStripeSignature
} from './stripe'

// Paying for Full Access (ADR 0022), given this request's database and payments. The routes build
// the first two with `userRoute`; Stripe's webhook has no session and is checked by its signature
// instead. `putItem` refuses a new Toot on an account without Full Access (402 `payment_required`).

/** This request's payments, from the Worker's env and the request's host. */
export function requestPayments(request: Request): Payments {
  return paymentsConfig(getCloudflareContext().env, request.headers.get('host'))
}

const notFound = () => apiError(404, 'not_found')
const unavailable = () => apiError(503, 'payments_unavailable')
const active = () => Response.json({ active: true })
/** The Full Access check's answer: with it, whether the account has as many Toots as it can keep. */
const accessAnswer = async ({ db }: Pick<Stores, 'db'>, user: SessionUser, isActive: boolean) =>
  Response.json({
    active: isActive,
    limitReached: isActive && (await liveItems(db, 'toots', user.id)) >= LIMITS.toots.maxItems
  })

/**
 * How much one user can ask of Stripe (#213), each a row in `rate_limit` (`consumeSlot`), keyed by
 * the user's id:
 *
 * - `checkouts`: checkouts that record a purchase and call Stripe (or the dev checkout), one per
 *   Pay tap. Past it, checkout answers 429 `rate_limited`.
 * - `stripeChecks`: the Full Access check's questions to Stripe. A return from Checkout asks up to
 *   15 times (`PAYMENT_WAIT`). Past it, the check answers from D1 alone, which the webhook keeps.
 */
export const PAYMENT_LIMITS = {
  checkouts: { window: 60 * 60, max: 20 },
  stripeChecks: { window: 10 * 60, max: 60 }
} as const satisfies Record<string, SlotRule>

/** Spends one of the user's `limit`, by D1's rate limiter. */
function spend(db: Stores['db'], user: SessionUser, limit: keyof typeof PAYMENT_LIMITS) {
  return consumeSlot(db.$client, `${limit}|${user.id}`, Date.now(), PAYMENT_LIMITS[limit])
}

/** A Stripe request failed: logged by its status alone, and answered 502. */
function stripeFailed(error: unknown): Response {
  if (!(error instanceof StripeError)) throw error
  console.error(JSON.stringify({ event: 'stripe_request_failed', status: error.status }))
  return apiError(502, 'payments_failed')
}

/** The Song of `songId`, from the catalog, or null. */
function catalogSong(songId: unknown) {
  return songIndex.find(song => song.id === songId) ?? null
}

/**
 * Where Checkout comes back to, which makes the same Toot again: the Song's Song Creator, or the
 * Sound Pad for a Toot of its Performance (a null `songId`, ADR 0017).
 */
function returnUrl(request: Request, songId: string | null, tootId: string, done: boolean): string {
  const url = new URL(
    songId === null ? '/compose/pad/' : `/compose/${songId}/`,
    servedOrigin(request)
  )
  url.searchParams.set('toot', tootId)
  if (done) url.searchParams.set('checkout', 'done')
  return url.toString()
}

/**
 * Asks Stripe about the account's latest Checkout Session (`purchase`, its row), and records it paid
 * if it paid the price the row recorded. Null when Stripe no longer has it (deleted test data, or
 * another Stripe account's key), so a new one starts.
 */
async function paidAtStripe(
  { db }: Pick<Stores, 'db'>,
  secretKey: string,
  user: SessionUser,
  purchase: FullAccessRow
): Promise<{ active: boolean; session: CheckoutSession } | null> {
  let session: CheckoutSession
  try {
    session = await retrieveCheckoutSession(secretKey, purchase.checkoutSessionId)
  } catch (error) {
    if (error instanceof StripeError && error.status === 404) return null
    throw error
  }
  if (!paidForFullAccess(session, user.id, purchase)) return { active: false, session }
  const paymentIntent = session.payment_intent ?? null
  return { active: await markFullAccessPaid(db, user.id, session.id, paymentIntent), session }
}

/**
 * `POST /api/full-access/checkout/` with `{ tootId, songId }`, the Toot whose Save asked for it and
 * its Song, null for a Sound Pad Toot (ADR 0017): where to pay for Full Access. `{ url }`, Stripe
 * Checkout's page (or `/dev/checkout/` on a local run), or `{ active: true }` when there's nothing
 * to pay: the account has it, or saving is free here. An open Checkout Session for the same Toot is
 * reused, and one for another Toot is ended first, as it returns elsewhere, so two taps or two tabs
 * can't pay twice. 410 for a Toot that's been deleted, 409 at the Toot limit (before anything is paid), 409 `payment_mismatch` when its
 * last session is paid but not at the price its row recorded (logged, and never paid for twice), 429
 * past `PAYMENT_LIMITS.checkouts`, 503 when payments aren't set up here.
 */
export async function startCheckout(
  { db }: Pick<Stores, 'db'>,
  payments: Payments,
  user: SessionUser,
  request: Request
): Promise<Response> {
  const wrong = wrongLibrary(user, request)
  if (wrong) return wrong
  if (payments.kind === 'free') return active()
  if (payments.kind === 'off') return unavailable()
  const body = await readJson(request)
  if (body instanceof Response) return body
  const { tootId, songId } = (body.json ?? {}) as { tootId?: unknown; songId?: unknown }
  // A Sound Pad Toot has no Song, and returns to the Pad.
  const song = songId === null ? null : catalogSong(songId)
  if (!isItemId(tootId) || (songId !== null && !song)) return apiError(400, 'invalid_request')

  if (await hasFullAccess(db, user.id)) return active()
  const saved = await uploadState(db, 'toots', user.id, tootId)
  // Deleted, it can't be saved again: nothing to pay for here.
  if (saved.status === 'deleted') return apiError(410, 'deleted')
  if (saved.live >= LIMITS.toots.maxItems) return apiError(409, 'limit_reached')
  const slot = await spend(db, user, 'checkouts')
  if (!slot.allowed) {
    const limited = apiError(429, 'rate_limited')
    limited.headers.set('Retry-After', String(slot.retryAfter))
    return limited
  }

  if (payments.kind === 'dev') {
    await startFullAccess(db, user.id, `dev_${crypto.randomUUID()}`, FULL_ACCESS_PRICE)
    await countStep(db, 'checkout-started')
    const url = new URL('/dev/checkout/', servedOrigin(request))
    url.searchParams.set('toot', tootId)
    if (song) url.searchParams.set('song', song.id)
    return Response.json({ url: url.toString() })
  }

  const purchase = await fullAccessPurchase(db, user.id)
  // Refunded, its session is paid and over: a new purchase starts.
  const earlier =
    purchase && !purchase.refundedAt && isCheckoutSessionId(purchase.checkoutSessionId)
      ? purchase
      : null
  try {
    if (earlier) {
      const atStripe = await paidAtStripe({ db }, payments.secretKey, user, earlier)
      if (atStripe?.active) return active()
      // Paid, but not what its row says it charged: never start a second payment.
      if (atStripe?.session.payment_status === 'paid') {
        console.error(
          JSON.stringify({ event: 'stripe_paid_session_refused', session: atStripe.session.id })
        )
        return apiError(409, 'payment_mismatch')
      }
      if (atStripe?.session.status === 'open' && atStripe.session.url) {
        if (atStripe.session.metadata?.toot_id === tootId) {
          return Response.json({ url: atStripe.session.url })
        }
        await expireCheckoutSession(payments.secretKey, atStripe.session.id)
      }
    }
    const session = await createCheckoutSession(payments.secretKey, {
      userId: user.id,
      tootId,
      successUrl: returnUrl(request, song?.id ?? null, tootId, true),
      cancelUrl: returnUrl(request, song?.id ?? null, tootId, false),
      replaces: purchase?.checkoutSessionId ?? null
    })
    if (!session.url) throw new StripeError(502)
    await startFullAccess(db, user.id, session.id, FULL_ACCESS_PRICE)
    await countStep(db, 'checkout-started')
    return Response.json({ url: session.url })
  } catch (error) {
    return stripeFailed(error)
  }
}

/**
 * `GET /api/full-access/`: `{ active, limitReached }`, whether the account has Full Access and, with
 * it, whether it's at the Toot limit, which Save says instead of saving. Without it but with an
 * unpaid Stripe Checkout Session, it asks Stripe, so the return from Checkout doesn't wait for the
 * webhook, up to `PAYMENT_LIMITS.stripeChecks`; past it, D1 alone answers. With `?check=stored` (the
 * Sound Pad's check on open) D1 alone answers, so the open never spends the return's Stripe checks:
 * a purchase whose webhook hasn't landed reads as none.
 */
export async function getFullAccess(
  { db }: Pick<Stores, 'db'>,
  payments: Payments,
  user: SessionUser,
  request: Request
): Promise<Response> {
  const wrong = wrongLibrary(user, request)
  if (wrong) return wrong
  const yes = () => accessAnswer({ db }, user, true)
  if (payments.kind === 'free' || (await hasFullAccess(db, user.id))) return yes()
  const none = () => accessAnswer({ db }, user, false)
  if (payments.kind !== 'stripe') return none()
  if (new URL(request.url).searchParams.get('check') === 'stored') return none()
  const purchase = await fullAccessPurchase(db, user.id)
  if (!purchase || purchase.paidAt || !isCheckoutSessionId(purchase.checkoutSessionId))
    return none()
  if (!(await spend(db, user, 'stripeChecks')).allowed) return none()
  try {
    const now = await paidAtStripe({ db }, payments.secretKey, user, purchase)
    return now?.active ? yes() : none()
  } catch (error) {
    return stripeFailed(error)
  }
}

/** The events that say a Checkout Session is paid: by card or wallet, or by a slower method. */
const PAID_EVENTS = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded'
])
/** Stripe's events are a few KB; anything far larger isn't one. */
const WEBHOOK_MAX_BYTES = 256 * 1024
const USER_ID = /^[A-Za-z0-9_-]{1,128}$/

const isUserId = (id: unknown): id is string => typeof id === 'string' && USER_ID.test(id)

/**
 * A paid Checkout Session marks what it paid for: the account's Full Access, or a Toot, for a
 * session still open when Full Access came. Only one started here, at the price its row recorded.
 */
async function recordPaid({ db }: Pick<Stores, 'db'>, session: CheckoutSession | undefined) {
  const userId = session?.metadata?.user_id
  if (!session || !isUserId(userId)) return
  if (session.metadata?.purchase === FULL_ACCESS_PURCHASE) {
    const purchase = await fullAccessPurchase(db, userId)
    if (purchase && paidForFullAccess(session, userId, purchase)) {
      await markFullAccessPaid(db, userId, session.id, session.payment_intent ?? null)
    }
    return
  }
  const tootId = session.metadata?.toot_id
  if (!isItemId(tootId)) return
  const payment = await tootPayment(db, userId, tootId)
  if (payment && paidForToot(session, userId, tootId, payment)) {
    await markTootPaid(db, userId, tootId, session.id)
  }
}

/** The fields Farty reads of a Stripe charge. */
type RefundedCharge = {
  /** True only once all of it is refunded. */
  refunded?: unknown
  payment_intent?: unknown
  metadata?: { user_id?: unknown; toot_id?: unknown } | null
}

/**
 * A full refund ends the Full Access it paid for: its purchase, by Stripe's payment id, or a Toot's
 * payment from before Full Access, by its metadata. Saved Toots stay. A partial refund changes
 * nothing.
 */
async function recordRefund({ db }: Pick<Stores, 'db'>, charge: RefundedCharge | undefined) {
  if (charge?.refunded !== true) return
  if (typeof charge.payment_intent === 'string') await refundFullAccess(db, charge.payment_intent)
  const userId = charge.metadata?.user_id
  const tootId = charge.metadata?.toot_id
  if (isUserId(userId) && isItemId(tootId)) await refundTootPayment(db, userId, tootId)
}

/**
 * `POST /api/stripe/webhook/`: Stripe's events, signed with the endpoint's secret. A paid Checkout
 * Session gives Full Access, and a full refund ends it. Every other signed event answers 200 and
 * changes nothing, so Stripe doesn't retry it. 400 for a missing, wrong or stale signature; 503 when
 * the webhook's secret isn't set here.
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
  // Live events on Production, test events everywhere else, as `paymentsConfig` takes the keys.
  if (typeof event.type === 'string' && event.livemode === payments.livemode) {
    const object = event.data?.object
    if (PAID_EVENTS.has(event.type)) await recordPaid({ db }, object as CheckoutSession | undefined)
    if (event.type === 'charge.refunded') {
      await recordRefund({ db }, object as RefundedCharge | undefined)
    }
  }
  return Response.json({ received: true })
}

/**
 * `POST /api/dev/checkout/`, a form with `toot` and `song`, or no `song` for a Sound Pad Toot: the
 * dev checkout's Pay. It marks the account's dev purchase paid and goes back to Song Creator, or the
 * Sound Pad, as Stripe's success URL would. 404 anywhere but a local run on a local host with no
 * Stripe key.
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
  const songId = form.get('song')
  const song = songId === null ? null : catalogSong(songId)
  if (!isItemId(tootId) || (songId !== null && !song)) return apiError(400, 'invalid_request')
  const purchase = await fullAccessPurchase(db, user.id)
  if (!purchase?.checkoutSessionId.startsWith('dev_')) return notFound()
  await markFullAccessPaid(db, user.id, purchase.checkoutSessionId, null)
  return new Response(null, {
    status: 303,
    headers: { Location: returnUrl(request, song?.id ?? null, tootId, true) }
  })
}

/** Whether `/dev/checkout/` serves here: a local run on a local host with no Stripe key. */
export function devCheckoutServes(host: string | null): boolean {
  return paymentsConfig(getCloudflareContext().env, host).kind === 'dev'
}
