import { siteEnv } from '@/lib/site'
import { parseReport, REPORT_MAX_BYTES } from '@/lib/telemetry/report'
import { readTelemetryRequest, refuse } from '@/server/telemetry-request'

/**
 * POST /api/telemetry/: one error report from this site's pages (#126, `src/lib/telemetry/`). It
 * logs one JSON line, `client_error`, which Workers Logs keeps, and answers 204.
 *
 * Anyone can call it, so it has no session: it reads no session, cookie, D1 or R2, and logs nothing
 * from the request but the report. It refuses what `readTelemetryRequest` refuses, and any report
 * that isn't exactly a known code with bounded fields (400, `parseReport`).
 */
export async function POST(request: Request): Promise<Response> {
  const body = await readTelemetryRequest(request, REPORT_MAX_BYTES)
  if (body instanceof Response) return body
  let report: ReturnType<typeof parseReport> = null
  try {
    report = parseReport(JSON.parse(body ?? ''))
  } catch {
    report = null
  }
  if (!report) return refuse(400, 'bad_report')
  console.error(JSON.stringify({ event: 'client_error', ...report, workerEnvironment: siteEnv() }))
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
}
