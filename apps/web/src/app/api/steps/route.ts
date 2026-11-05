import { addStepCount } from '@/db/step-counts'
import { parseStep, STEP_MAX_BYTES } from '@/lib/telemetry/step-names'
import { requestStores } from '@/server/library'
import { readTelemetryRequest, refuse } from '@/server/telemetry-request'

// Public: a new visitor counts their steps before they have any account (#405), so it reads no
// session. `every-route.workers.test.ts` leaves it out; its own tests are in
// `steps.workers.test.ts`.
export const dynamic = 'force-dynamic'

/**
 * POST /api/steps/ with `{ step }`: adds one to today's count of that step, and answers 204. It
 * keeps nothing from the request but the step's name. It refuses what `readTelemetryRequest`
 * refuses, and anything but exactly one of a browser's steps (400, `parseStep`).
 */
export async function POST(request: Request): Promise<Response> {
  const body = await readTelemetryRequest(request, STEP_MAX_BYTES)
  if (body instanceof Response) return body
  let step: ReturnType<typeof parseStep> = null
  try {
    step = parseStep(JSON.parse(body ?? ''))
  } catch {
    step = null
  }
  if (!step) return refuse(400, 'bad_step')
  try {
    await addStepCount(requestStores().db, step)
  } catch {
    console.error(JSON.stringify({ event: 'step_count_failed', step }))
    return refuse(500, 'server_error')
  }
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
}
