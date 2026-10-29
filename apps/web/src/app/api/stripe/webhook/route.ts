import { getDb } from '@/db'
import { apiError } from '@/server/http'
import { logRouteFailure } from '@/server/route-failure'
import { receiveStripeEvent, requestPayments } from '@/server/toot-payments'

export async function POST(request: Request): Promise<Response> {
  let response: Response
  try {
    response = await receiveStripeEvent({ db: getDb() }, requestPayments(request), request)
  } catch (error) {
    logRouteFailure('stripe_webhook_failed', error, request)
    response = apiError(500, 'server_error')
  }
  response.headers.set('Cache-Control', 'no-store')
  return response
}
