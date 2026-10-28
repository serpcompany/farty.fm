import { getCloudflareContext } from '@opennextjs/cloudflare'
import { z } from 'zod'

import { uploadState } from '@/db/library'
import {
  markTootPaid,
  paidUnsavedToot,
  startTootPayment,
  type TootPaymentRow,
  tootPayment
} from '@/db/payments'
import { songs } from '@/lib/catalog/songs.generated'
import { TOOT_PRICE } from '@/lib/pricing'
import { servedOrigin } from '@/lib/site'

import type { SessionUser } from './auth-session'
import { apiError, gone, notFound, readCapped } from './http'
import { LIMITS, refusedItemRequest, type Stores } from './library'
import { isItemId, readJson } from './library-input'
import { consumeSlot, type SlotRule } from './rate-limits'
import {
  CHECKOUT_SESSION,
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

type WithDb = Pick<Stores, 'db'>

export function requestPayments(request: Request): Payments {
  return paymentsConfig(getCloudflareContext().env, request.headers.get('host'))
}

const unavailable = () => apiError(503, 'payments_unavailable')
const paid = () => Response.json({ paid: true })

export const PAYMENT_LIMITS = {
  checkouts: { window: 60 * 60, max: 20 },
  stripeChecks: { window: 10 * 60, max: 60 }
} as const satisfies Record<string, SlotRule>

function spend({ db }: WithDb, user: SessionUser, limit: keyof typeof PAYMENT_LIMITS) {
  return consumeSlot(db.$client, `${limit}|${user.id}`, Date.now(), PAYMENT_LIMITS[limit])
}

function rateLimited(retryAfter: number | null): Response {
  const limited = apiError(429, 'rate_limited')
  limited.headers.set('Retry-After', String(retryAfter))
  return limited
}

function stripeFailed(error: unknown): Response {
  if (!(error instanceof StripeError)) throw error
  console.error(JSON.stringify({ event: 'stripe_request_failed', status: error.status }))
  return apiError(502, 'payments_failed')
}

function catalogSong(songId: unknown) {
  return songs.find(song => song.id === songId) ?? null
}

function songCreatorUrl(request: Request, songId: string, tootId: string, done: boolean): string {
  const url = new URL(`/compose/${songId}/`, servedOrigin(request))
  url.searchParams.set('toot', tootId)
  if (done) url.searchParams.set('checkout', 'done')
  return url.toString()
}

async function paidAtStripe(
  { db }: WithDb,
  secretKey: string,
  user: SessionUser,
  payment: TootPaymentRow
): Promise<{ paid: boolean; session: CheckoutSession } | null> {
  let session: CheckoutSession
  try {
    session = await retrieveCheckoutSession(secretKey, payment.checkoutSessionId)
  } catch (error) {
    if (error instanceof StripeError && error.status === 404) return null
    throw error
  }
  if (!paidFor(session, user.id, payment.tootId, payment)) return { paid: false, session }
  return { paid: await markTootPaid(db, user.id, payment.tootId, session.id), session }
}

function paidAtAnotherPrice(session: CheckoutSession): Response {
  console.error(JSON.stringify({ event: 'stripe_paid_session_refused', session: session.id }))
  return apiError(409, 'payment_mismatch')
}

function devCheckout(request: Request, tootId: string, songId: string): Response {
  const url = new URL('/dev/checkout/', servedOrigin(request))
  url.searchParams.set('toot', tootId)
  url.searchParams.set('song', songId)
  return Response.json({ url: url.toString() })
}

type Song = (typeof songs)[number]

type StripeCheckout = WithDb & {
  secretKey: string
  user: SessionUser
  tootId: string
  song: Song
  payment: TootPaymentRow | null
  request: Request
}

async function stripeCheckout({
  db,
  secretKey,
  user,
  tootId,
  song,
  payment,
  request
}: StripeCheckout): Promise<Response> {
  const earlier = payment && isCheckoutSessionId(payment.checkoutSessionId) ? payment : null
  if (earlier) {
    const atStripe = await paidAtStripe({ db }, secretKey, user, earlier)
    if (atStripe?.paid) return paid()
    if (atStripe?.session.payment_status === 'paid') return paidAtAnotherPrice(atStripe.session)
    if (atStripe?.session.status === 'open' && atStripe.session.url) {
      return Response.json({ url: atStripe.session.url })
    }
  }
  const session = await createCheckoutSession(secretKey, {
    userId: user.id,
    tootId,
    songTitle: song.title,
    successUrl: songCreatorUrl(request, song.id, tootId, true),
    cancelUrl: songCreatorUrl(request, song.id, tootId, false),
    replaces: earlier?.checkoutSessionId ?? null
  })
  if (!session.url) throw new StripeError(502)
  await startTootPayment(db, user.id, tootId, song.id, session.id, TOOT_PRICE)
  return Response.json({ url: session.url })
}

const CHECKOUT_REQUEST = z.object({ songId: z.string() })

type TootPaymentRoute = (
  stores: WithDb,
  payments: Payments,
  user: SessionUser,
  id: string,
  request: Request
) => Promise<Response>

export const startCheckout: TootPaymentRoute = async ({ db }, payments, user, id, request) => {
  const refused = refusedItemRequest(user, id, request)
  if (refused) return refused
  if (payments.kind === 'free') return paid()
  if (payments.kind === 'off') return unavailable()
  const body = await readJson(request, CHECKOUT_REQUEST)
  if (body instanceof Response) return body
  const song = catalogSong(body.json.songId)
  if (!song) return apiError(400, 'invalid_request')

  const saved = await uploadState(db, 'toots', user.id, id)
  if (saved.status === 'live') return paid()
  if (saved.status === 'deleted') return gone()
  const payment = await tootPayment(db, user.id, id)
  if (payment?.savedAt) return gone()
  if (payment?.paidAt) return paid()
  if (saved.live >= LIMITS.toots.maxItems) return apiError(409, 'limit_reached')
  const unsaved = await paidUnsavedToot(db, user.id, song.id, id)
  if (unsaved) return Response.json({ paidToot: unsaved })
  const slot = await spend({ db }, user, 'checkouts')
  if (!slot.allowed) return rateLimited(slot.retryAfter)

  if (payments.kind === 'dev') {
    const sessionId = payment?.checkoutSessionId.startsWith('dev_')
      ? payment.checkoutSessionId
      : `dev_${crypto.randomUUID()}`
    await startTootPayment(db, user.id, id, song.id, sessionId, TOOT_PRICE)
    return devCheckout(request, id, song.id)
  }
  try {
    const { secretKey } = payments
    return await stripeCheckout({ db, secretKey, user, tootId: id, song, payment, request })
  } catch (error) {
    return stripeFailed(error)
  }
}

export const getTootPayment: TootPaymentRoute = async ({ db }, payments, user, id, request) => {
  const refused = refusedItemRequest(user, id, request)
  if (refused) return refused
  if (payments.kind === 'free') return paid()
  const payment = await tootPayment(db, user.id, id)
  if (payment?.paidAt) return paid()
  if (payment && payments.kind === 'stripe' && isCheckoutSessionId(payment.checkoutSessionId)) {
    if (!(await spend({ db }, user, 'stripeChecks')).allowed) return Response.json({ paid: false })
    try {
      const now = await paidAtStripe({ db }, payments.secretKey, user, payment)
      return Response.json({ paid: now?.paid ?? false })
    } catch (error) {
      return stripeFailed(error)
    }
  }
  return Response.json({ paid: false })
}

const WEBHOOK_MAX_BYTES = 256 * 1024

const PAID_EVENT = z.object({
  type: z.enum(['checkout.session.completed', 'checkout.session.async_payment_succeeded']),
  livemode: z.boolean(),
  data: z.object({
    object: CHECKOUT_SESSION.extend({
      metadata: z.object({
        user_id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
        toot_id: z.string().refine(isItemId)
      })
    })
  })
})

export async function receiveStripeEvent(
  { db }: WithDb,
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
  let event: unknown
  try {
    event = JSON.parse(new TextDecoder().decode(body))
  } catch {
    return apiError(400, 'invalid_request')
  }
  const paidEvent = PAID_EVENT.safeParse(event)
  if (paidEvent.success && paidEvent.data.livemode === payments.livemode) {
    const session = paidEvent.data.data.object
    const { user_id: userId, toot_id: tootId } = session.metadata
    const payment = await tootPayment(db, userId, tootId)
    if (payment && paidFor(session, userId, tootId, payment)) {
      await markTootPaid(db, userId, tootId, session.id)
    }
  }
  return Response.json({ received: true })
}

export async function payDevCheckout(
  { db }: WithDb,
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

export function devCheckoutServes(host: string | null): boolean {
  return paymentsConfig(getCloudflareContext().env, host).kind === 'dev'
}
