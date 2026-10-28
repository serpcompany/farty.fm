import { beforeEach, describe, expect, it, vi } from 'vitest'

import { startTootPayment, tootPayment } from '@/db/payments'
import { TOOT_PRICE } from '@/lib/pricing'
import type { CheckoutSession, Payments } from '@/server/stripe'
import {
  devCheckoutServes,
  getTootPayment,
  receiveStripeEvent,
  startCheckout
} from '@/server/toot-payments'
import { extraEnv } from '@/test-support/extra-env'
import { ORIGIN, signUp, T1, testDb } from '@/test-support/library-api'
import {
  checkout,
  completed,
  deliver,
  eventRequest,
  expectSavedOnceStripeSaysPaid,
  HOST,
  headersFor,
  payDev,
  paymentsHarness,
  save,
  stubStripe,
  T2
} from '@/test-support/payments-api'
import {
  LIVE_KEY,
  checkoutSession as sessionFor,
  TEST_KEY,
  WEBHOOK_SECRET
} from '@/test-support/stripe'

vi.mock('@opennextjs/cloudflare', async () =>
  (await import('@/test-support/extra-env')).cloudflareWithExtraEnv()
)

paymentsHarness()

describe('live and test mode', () => {
  const payments = (livemode: boolean): Payments => ({
    kind: 'stripe',
    secretKey: livemode ? LIVE_KEY : TEST_KEY,
    webhookSecret: WEBHOOK_SECRET,
    livemode
  })

  it('takes only live events in live mode, and only test events in test mode', async () => {
    const a = await signUp('A')
    await startTootPayment(testDb(), a.id, T1, 'twinkle', 'cs_live_first', TOOT_PRICE)
    await startTootPayment(testDb(), a.id, T2, 'twinkle', 'cs_test_first', TOOT_PRICE)
    const live = sessionFor(a.id, T1, {
      id: 'cs_live_first',
      status: 'complete',
      payment_status: 'paid',
      livemode: true
    })
    const test = sessionFor(a.id, T2, { status: 'complete', payment_status: 'paid' })
    const receive = async (livemode: boolean, session: CheckoutSession) => {
      const request = await eventRequest(completed(session))
      return (await receiveStripeEvent({ db: testDb() }, payments(livemode), request)).status
    }

    expect(await receive(true, test)).toBe(200)
    expect(await receive(false, live)).toBe(200)
    expect((await tootPayment(testDb(), a.id, T1))?.paidAt).toBeNull()
    expect((await tootPayment(testDb(), a.id, T2))?.paidAt).toBeNull()

    expect(await receive(true, live)).toBe(200)
    expect(await receive(false, test)).toBe(200)
    expect((await tootPayment(testDb(), a.id, T1))?.paidAt).toBeInstanceOf(Date)
    expect((await tootPayment(testDb(), a.id, T2))?.paidAt).toBeInstanceOf(Date)
  })
})

describe('with saving free', () => {
  it('answers paid to checkout and payment, with no checkout and no Stripe', async () => {
    const a = await signUp('A')
    const user = { id: a.id, email: a.email, marketingEmail: true, signedInAt: new Date() }
    const stripe = vi.spyOn(globalThis, 'fetch')
    const free: Payments = { kind: 'free' }
    const request = (path: string, init: RequestInit = {}) =>
      new Request(`${ORIGIN}/api/toots/${T1}/${path}/`, {
        ...init,
        headers: headersFor(init.method ?? 'GET', a, { 'content-type': 'application/json' })
      })
    const started = await startCheckout(
      { db: testDb() },
      free,
      user,
      T1,
      request('checkout', { method: 'POST', body: JSON.stringify({ songId: 'twinkle' }) })
    )
    expect(await started.json()).toEqual({ paid: true })
    const payment = await getTootPayment({ db: testDb() }, free, user, T1, request('payment'))
    expect(await payment.json()).toEqual({ paid: true })
    expect(await tootPayment(testDb(), a.id, T1)).toBeNull()
    expect(stripe).not.toHaveBeenCalled()
  })
})

type User = { id: string; cookie: string }

async function expectNoDevCheckout(a: User) {
  expect((await payDev(T1, a)).status).toBe(404)
  expect(devCheckoutServes(HOST)).toBe(false)
}

async function expectNoPaymentTaken(a: User, keys: unknown[]) {
  const stripe = vi.spyOn(globalThis, 'fetch')
  for (const key of keys) {
    extraEnv.STRIPE_SECRET_KEY = key
    const refused = await checkout(T1, a)
    expect(refused.status).toBe(503)
    expect(await refused.json()).toEqual({ error: 'payments_unavailable' })
    await expectNoDevCheckout(a)
  }
  expect((await save(T1, a)).status).toBe(402)
  expect(stripe).not.toHaveBeenCalled()
}

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
    await expectNoDevCheckout(a)
    expect((await save(T1, a)).status).toBe(402)
  })

  it('takes no payment without a test key, and never stands in for Checkout', async () => {
    const a = await signUp('A')
    await expectNoPaymentTaken(a, [undefined, LIVE_KEY, 'rk_live_madeUpForTheTests'])
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
    await expectNoDevCheckout(a)
    await expectSavedOnceStripeSaysPaid(T1, a)
    expect(stripe).toHaveBeenCalledTimes(2)
  })

  it('marks a Toot paid from a signed live event, never from a test one', async () => {
    extraEnv.STRIPE_SECRET_KEY = LIVE_KEY
    extraEnv.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET
    const a = await signUp('A')
    await startTootPayment(testDb(), a.id, T1, 'twinkle', 'cs_live_first', TOOT_PRICE)
    const session = liveSession(a.id, T1, { status: 'complete', payment_status: 'paid' })
    expect((await deliver(completed({ ...session, livemode: false }))).status).toBe(200)
    expect((await tootPayment(testDb(), a.id, T1))?.paidAt).toBeNull()
    expect((await deliver(completed(session))).status).toBe(200)
    expect((await tootPayment(testDb(), a.id, T1))?.paidAt).toBeInstanceOf(Date)
    expect((await save(T1, a)).status).toBe(201)
  })

  it('takes no payment without a live key, and never stands in for Checkout', async () => {
    const a = await signUp('A')
    await expectNoPaymentTaken(a, [undefined, TEST_KEY, 'rk_test_madeUpForTheTests'])
  })
})
