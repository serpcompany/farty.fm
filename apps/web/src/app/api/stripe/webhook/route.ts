import { getDb } from '@/db'
import { receiveStripeEvent, requestPayments } from '@/server/full-access'
import { apiError } from '@/server/require-user'

// Stripe's events (ADR 0022). The one route outside `api/auth/` and `api/telemetry/` with no
// session: Stripe signs each event with the endpoint's secret, which `receiveStripeEvent` checks
// before reading anything. The Staging gate lets it through (`src/lib/staging-access.ts`).

/** A paid Checkout Session gives Full Access, and a full refund ends it. */
export async function POST(request: Request): Promise<Response> {
  let response: Response
  try {
    response = await receiveStripeEvent({ db: getDb() }, requestPayments(request), request)
  } catch {
    // A 500, so Stripe sends the event again later. Logged by the route alone.
    console.error('POST /api/stripe/webhook/ failed')
    response = apiError(500, 'server_error')
  }
  response.headers.set('Cache-Control', 'no-store')
  return response
}
