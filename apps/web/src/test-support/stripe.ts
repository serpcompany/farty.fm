import { hmacHex } from '@/server/hmac'
import type { CheckoutSession } from '@/server/stripe'

export const TEST_KEY = 'sk_test_madeUpForTheTests'
export const LIVE_KEY = 'sk_live_madeUpForTheTests'
export const WEBHOOK_SECRET = 'whsec_madeUpForTheTests'

export const stripeV1 = (payload: string, timestamp: number, secret = WEBHOOK_SECRET) =>
  hmacHex(secret, `${timestamp}.${payload}`)

export function checkoutSession(
  userId: string,
  tootId: string,
  fields: Partial<CheckoutSession> = {}
): CheckoutSession {
  return {
    id: 'cs_test_first',
    url: 'https://checkout.stripe.com/c/pay/cs_test_first',
    mode: 'payment',
    status: 'open',
    payment_status: 'unpaid',
    client_reference_id: tootId,
    metadata: { user_id: userId, toot_id: tootId },
    livemode: false,
    amount_total: 99,
    currency: 'usd',
    ...fields
  }
}
