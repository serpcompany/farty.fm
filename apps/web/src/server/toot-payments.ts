import { getCloudflareContext } from '@opennextjs/cloudflare'
import { z } from 'zod'

import { uploadState } from '@/db/library'
import { markTootPaid, startTootPayment, type TootPaymentRow, tootPayment } from '@/db/payments'
import { songs } from '@/lib/catalog/songs.generated'
import { TOOT_PRICE } from '@/lib/pricing'
import { servedOrigin } from '@/lib/site'

import type { SessionUser } from './auth-session'
import { apiError, gone, notFound, readCapped } from './http'
import { LIMITS, refusedItemRequest, type Stores } from './library'
import { isItemId, readJson } from './library-input'
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
  if (payment && isCheckoutSessionId(payment.checkoutSessionId)) {
    const earlier = await paidAtStripe({ db }, secretKey, user, tootId, payment.checkoutSessionId)
    if (earlier?.paid) return paid()
    if (earlier?.session.status === 'open' && earlier.session.url) {
      return Response.json({ url: earlier.session.url })
    }
  }
  const session = await createCheckoutSession(secretKey, {
    userId: user.id,
    tootId,
    songTitle: song.title,
    successUrl: songCreatorUrl(request, song.id, tootId, true),
    cancelUrl: songCreatorUrl(request, song.id, tootId, false)
  })
  if (!session.url) throw new StripeError(502)
  await startTootPayment(db, user.id, tootId, session.id, TOOT_PRICE)
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
  if (payment?.paidAt) return paid()
  if (saved.live >= LIMITS.toots.maxItems) return apiError(409, 'limit_reached')

  if (payments.kind === 'dev') {
    const sessionId = payment?.checkoutSessionId.startsWith('dev_')
      ? payment.checkoutSessionId
      : `dev_${crypto.randomUUID()}`
    await startTootPayment(db, user.id, id, sessionId, TOOT_PRICE)
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

const WEBHOOK_MAX_BYTES = 256 * 1024

const PAID_TEST_EVENT = z.object({
  type: z.enum(['checkout.session.completed', 'checkout.session.async_payment_succeeded']),
  livemode: z.literal(false),
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
  const paidEvent = PAID_TEST_EVENT.safeParse(event)
  if (paidEvent.success) {
    const session = paidEvent.data.data.object
    const { user_id: userId, toot_id: tootId } = session.metadata
    if (paidFor(session, userId, tootId)) await markTootPaid(db, userId, tootId, session.id)
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
