import { env } from 'cloudflare:test'
import { afterEach, beforeEach, expect, vi } from 'vitest'

import * as devCheckoutRoute from '@/app/api/dev/checkout/route'
import * as webhookRoute from '@/app/api/stripe/webhook/route'
import * as checkoutRoute from '@/app/api/toots/[id]/checkout/route'
import * as paymentRoute from '@/app/api/toots/[id]/payment/route'
import type { CheckoutSession } from '@/server/stripe'

import { extraEnv } from './extra-env'
import { api, CF_RAY, ORIGIN, tootMetadata, uploadBody, wav } from './library-api'
import { stripeV1, WEBHOOK_SECRET } from './stripe'

export const T2 = '44444444-4444-4444-8444-444444444444'
export const T3 = '55555555-5555-4555-8555-555555555555'
export const HOST = new URL(ORIGIN).host

export function paymentsHarness() {
  beforeEach(() => {
    for (const key of Object.keys(extraEnv)) delete extraEnv[key]
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })
}

type As = { cookie?: string; library?: string; host?: string }

export function headersFor(
  method: string,
  { cookie, library, host = HOST }: As,
  extra: HeadersInit = {}
) {
  const headers = new Headers(extra)
  headers.set('host', host)
  if (cookie) headers.set('cookie', cookie)
  if (library) headers.set('x-pedos-library', library)
  if (method !== 'GET') headers.set('origin', ORIGIN)
  return headers
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

export const checkout = (id: string, as: As, songId: unknown = 'twinkle') =>
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

export const payDev = (toot: string, as: As, song = 'twinkle') =>
  devCheckoutRoute.POST(
    new Request(`${ORIGIN}/api/dev/checkout/`, {
      method: 'POST',
      headers: headersFor('POST', as, { 'content-type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams({ toot, song })
    }),
    { params: Promise.resolve({}) }
  )

export const save = (id: string, as: As) =>
  api.put('toots', id, uploadBody(tootMetadata(id), wav()), as, {
    headers: { host: as.host ?? HOST }
  })

export async function paid(id: string, as: As): Promise<boolean> {
  const response = await payment(id, as)
  expect(response.status).toBe(200)
  return ((await response.json()) as { paid: boolean }).paid
}

export async function expectSavedOnceStripeSaysPaid(id: string, as: As) {
  expect((await save(id, as)).status).toBe(402)
  expect(await paid(id, as)).toBe(true)
  expect((await save(id, as)).status).toBe(201)
}

export async function tootRows(userId: string) {
  const { results } = await env.DB.prepare(
    'select id, deleted_at from toots where user_id = ?1 order by id'
  )
    .bind(userId)
    .all<{ id: string; deleted_at: number | null }>()
  return results
}

export function stubStripe(...answers: (CheckoutSession | Response)[]) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    const next = answers.shift()
    if (!next) throw new Error('Stripe was asked once too often')
    return next instanceof Response ? next : Response.json(next)
  })
}

type Signing = { secret?: string; timestamp?: number }

export async function eventRequest(
  event: unknown,
  { secret = WEBHOOK_SECRET, timestamp = Math.floor(Date.now() / 1000) }: Signing = {}
) {
  const payload = JSON.stringify(event)
  return new Request(`${ORIGIN}/api/stripe/webhook/`, {
    method: 'POST',
    headers: {
      host: 'staging.farty.fm',
      'content-type': 'application/json',
      'stripe-signature': `t=${timestamp},v1=${await stripeV1(payload, timestamp, secret)}`,
      'cf-ray': CF_RAY
    },
    body: payload
  })
}

export async function deliver(event: unknown, signing: Signing = {}) {
  return webhookRoute.POST(await eventRequest(event, signing))
}

export const completed = (session: CheckoutSession, type = 'checkout.session.completed') => ({
  id: 'evt_test_1',
  object: 'event',
  type,
  livemode: session.livemode,
  data: { object: session }
})
