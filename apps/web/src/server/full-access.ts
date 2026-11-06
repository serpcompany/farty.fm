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
import { tabs } from '@/lib/tabs'

import { consumeSlot, type SlotRule } from './auth-config'
import { createEmailSender, saleEmailConfig } from './email'
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
 * The page an offer before Save comes back to (#407): a tab, the Sound Pad or a Song in the catalog,
 * and otherwise Record. Never an address a request made up, since Checkout sends the buyer there.
 */
export function offerPage(path: unknown): string {
  if (typeof path !== 'string') return '/'
  if (path === '/compose/pad/' || tabs.some(tab => tab.href === path)) return path
  const song = /^\/compose\/([^/]+)\/$/.exec(path)
  return song && catalogSong(song[1]) ? path : '/'
}

/**
 * What a checkout is for, which says where Checkout comes back to: for a Save, the screen that makes
 * the same Toot again, the Song's Song Creator or the Sound Pad for a Toot of its Performance (a null
 * `songId`, ADR 0017); for a saved Toot's Download, that Toot's screen (#408); for an offer before
 * Save, the page it says (#407), with no Toot at all.
 */
type CheckoutFor =
  | { to: 'compose'; tootId: string; songId: string | null }
  | { to: 'toot'; tootId: string }
  | { to: 'page'; path: string }

/** What a checkout's fields say it's for, or null for a bad Toot id or a Song not in the catalog. */
function checkoutFor(fields: {
  tootId: unknown
  songId: unknown
  returnTo: unknown
  path: unknown
}): CheckoutFor | null {
  const { tootId, songId, returnTo, path } = fields
  if (returnTo === 'page') return { to: 'page', path: offerPage(path) }
  if (!isItemId(tootId)) return null
  if (returnTo === 'toot') return { to: 'toot', tootId }
  if (songId === null) return { to: 'compose', tootId, songId: null }
  const song = catalogSong(songId)
  return song ? { to: 'compose', tootId, songId: song.id } : null
}

function returnUrl(request: Request, back: CheckoutFor, done: boolean): string {
  if (back.to === 'page') {
    const url = new URL(back.path, servedOrigin(request))
    if (done) url.searchParams.set('offer', 'done')
    return url.toString()
  }
  const url = new URL(
    back.to === 'toot'
      ? '/toots/toot/'
      : back.songId === null
        ? '/compose/pad/'
        : `/compose/${back.songId}/`,
    servedOrigin(request)
  )
  url.searchParams.set(back.to === 'toot' ? 'id' : 'toot', back.tootId)
  if (done) url.searchParams.set('checkout', 'done')
  return url.toString()
}

/**
 * Records the account's purchase paid, and tells the owner if that's what made it paid: every way a
 * purchase gets paid comes through here, and the payment is in D1 before the email starts. The email
 * goes after the answer, so neither Stripe nor the buyer waits on it: `waitUntil` keeps the Worker
 * going for it, and `sendSale` never throws. True when the account has Full Access now.
 */
async function recordFullAccessPaid(
  { db }: Pick<Stores, 'db'>,
  request: Request,
  userId: string,
  checkoutSessionId: string,
  paymentIntent: string | null
): Promise<boolean> {
  const paid = await markFullAccessPaid(db, userId, checkoutSessionId, paymentIntent)
  if (paid.firstPaid) {
    const { env, ctx } = getCloudflareContext()
    const config = saleEmailConfig(env, request.headers.get('host'))
    ctx.waitUntil(createEmailSender(config).sendSale(paymentIntent))
  }
  return paid.active
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
  purchase: FullAccessRow,
  request: Request
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
  const active = await recordFullAccessPaid({ db }, request, user.id, session.id, paymentIntent)
  return { active, session }
}

/**
 * `POST /api/full-access/checkout/` with `{ tootId, songId }`, the Toot whose Save asked for it and
 * its Song, null for a Sound Pad Toot (ADR 0017), or `{ tootId, returnTo: 'toot' }`, the saved Toot
 * whose Download asked for it (#408), or `{ returnTo: 'page', path }`, an offer before Save (#407):
 * where to pay for Full Access. `{ url }`, Stripe Checkout's page (or `/dev/checkout/` on a local
 * run), or `{ active: true }` when there's nothing to pay: the account has it, or saving is free
 * here. An open Checkout Session that comes back to the same place is reused, and any other is ended
 * first, as it returns elsewhere, so two taps or two tabs can't pay twice. 410 for a Toot that's been deleted and, for a Save, 409 at the Toot limit, with Full Access
 * or not and before anything is paid, 409 `payment_mismatch` when its last session is paid but not
 * at the price its row recorded (logged, and never paid for twice), 429 past
 * `PAYMENT_LIMITS.checkouts`, 503 when payments aren't set up here.
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
  const { tootId, songId, returnTo, path } = (body.json ?? {}) as {
    tootId?: unknown
    songId?: unknown
    returnTo?: unknown
    path?: unknown
  }
  const back = checkoutFor({ tootId, songId, returnTo, path })
  if (!back) return apiError(400, 'invalid_request')

  if (back.to !== 'page') {
    const saved = await uploadState(db, 'toots', user.id, back.tootId)
    // Deleted, it can't be saved again: nothing to pay for here.
    if (saved.status === 'deleted') return apiError(410, 'deleted')
    // Downloading keeps no new Toot, so the limit only stops a Save.
    if (back.to === 'compose' && saved.live >= LIMITS.toots.maxItems) {
      return apiError(409, 'limit_reached')
    }
  }
  if (await hasFullAccess(db, user.id)) return active()
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
    if (back.to === 'page') {
      url.searchParams.set('return', 'page')
      url.searchParams.set('path', back.path)
    } else {
      url.searchParams.set('toot', back.tootId)
      if (back.to === 'toot') url.searchParams.set('return', 'toot')
      else if (back.songId !== null) url.searchParams.set('song', back.songId)
    }
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
      const atStripe = await paidAtStripe({ db }, payments.secretKey, user, earlier, request)
      if (atStripe?.active) return active()
      // Paid, but not what its row says it charged: never start a second payment.
      if (atStripe?.session.payment_status === 'paid') {
        console.error(
          JSON.stringify({ event: 'stripe_paid_session_refused', session: atStripe.session.id })
        )
        return apiError(409, 'payment_mismatch')
      }
      if (atStripe?.session.status === 'open' && atStripe.session.url) {
        const { metadata } = atStripe.session
        const sameReturn =
          back.to === 'page'
            ? metadata?.return_page === back.path
            : metadata?.toot_id === back.tootId
        if (sameReturn) return Response.json({ url: atStripe.session.url })
        await expireCheckoutSession(payments.secretKey, atStripe.session.id)
      }
    }
    const session = await createCheckoutSession(payments.secretKey, {
      userId: user.id,
      email: user.email,
      ...(back.to === 'page' ? { page: back.path } : { tootId: back.tootId }),
      successUrl: returnUrl(request, back, true),
      cancelUrl: returnUrl(request, back, false),
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
    const now = await paidAtStripe({ db }, payments.secretKey, user, purchase, request)
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
async function recordPaid(
  { db }: Pick<Stores, 'db'>,
  session: CheckoutSession | undefined,
  request: Request
) {
  const userId = session?.metadata?.user_id
  if (!session || !isUserId(userId)) return
  if (session.metadata?.purchase === FULL_ACCESS_PURCHASE) {
    const purchase = await fullAccessPurchase(db, userId)
    if (purchase && paidForFullAccess(session, userId, purchase)) {
      const paymentIntent = session.payment_intent ?? null
      await recordFullAccessPaid({ db }, request, userId, session.id, paymentIntent)
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
    if (PAID_EVENTS.has(event.type)) {
      await recordPaid({ db }, object as CheckoutSession | undefined, request)
    }
    if (event.type === 'charge.refunded') {
      await recordRefund({ db }, object as RefundedCharge | undefined)
    }
  }
  return Response.json({ received: true })
}

/**
 * `POST /api/dev/checkout/`, a form with `toot` and `song`, or no `song` for a Sound Pad Toot, or
 * `return=toot` for a saved Toot's Download, or `return=page` and `path` for an offer before Save:
 * the dev checkout's Pay. It marks the account's dev purchase paid and goes back to Song Creator, the
 * Sound Pad, the Toot's screen or the page, as Stripe's success URL would. 404 anywhere but a local run on a local host with no Stripe key.
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
  const back = checkoutFor({
    tootId: form.get('toot'),
    songId: form.get('song'),
    returnTo: form.get('return'),
    path: form.get('path')
  })
  if (!back) return apiError(400, 'invalid_request')
  const purchase = await fullAccessPurchase(db, user.id)
  if (!purchase?.checkoutSessionId.startsWith('dev_')) return notFound()
  await recordFullAccessPaid({ db }, request, user.id, purchase.checkoutSessionId, null)
  return new Response(null, {
    status: 303,
    headers: { Location: returnUrl(request, back, true) }
  })
}

/** Whether `/dev/checkout/` serves here: a local run on a local host with no Stripe key. */
export function devCheckoutServes(host: string | null): boolean {
  return paymentsConfig(getCloudflareContext().env, host).kind === 'dev'
}
