import { getCloudflareContext } from '@opennextjs/cloudflare'
import { servedOrigin, siteEnv } from '@/lib/site'
import { parseReport, REPORT_MAX_BYTES } from '@/lib/telemetry/report'

/**
 * POST /api/telemetry/: one error report from this site's pages (#126, `src/lib/telemetry/`). It
 * logs one JSON line, `client_error`, which Workers Logs keeps, and answers 204.
 *
 * Anyone can call it, so it is the one route outside `api/auth/` with no session: it reads no
 * session, cookie, D1 or R2, and logs nothing from the request but the report. It refuses a client
 * over `TELEMETRY_RATE_LIMIT` (429, 30 a minute per `cf-connecting-ip`, `wrangler.jsonc`), another
 * origin (403), anything but JSON (415), a body over `REPORT_MAX_BYTES` (413), and any report that
 * isn't exactly a known code with bounded fields (400, `parseReport`).
 */
export async function POST(request: Request): Promise<Response> {
  if (!(await withinLimit(request))) return refuse(429, 'rate_limited')
  if (request.headers.get('origin') !== servedOrigin(request)) return refuse(403, 'cross_origin')
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return refuse(415, 'not_json')
  }
  const body = await readBody(request)
  if (body === 'too_large') return refuse(413, 'too_large')
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

/**
 * Whether this client is within the limit. With no binding (unit tests, `next dev`), every request
 * is.
 */
async function withinLimit(request: Request): Promise<boolean> {
  let limiter: RateLimit | undefined
  try {
    limiter = getCloudflareContext().env.TELEMETRY_RATE_LIMIT
  } catch {
    limiter = undefined
  }
  if (!limiter) return true
  const key = request.headers.get('cf-connecting-ip') ?? 'unknown'
  const { success } = await limiter.limit({ key })
  return success
}

function refuse(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } })
}

/** The body as UTF-8, read no further than the limit; null when it isn't UTF-8. */
async function readBody(request: Request): Promise<string | 'too_large' | null> {
  if (Number(request.headers.get('content-length') ?? 0) > REPORT_MAX_BYTES) return 'too_large'
  if (!request.body) return null
  const reader = request.body.getReader()
  const bytes = new Uint8Array(REPORT_MAX_BYTES)
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (size + value.byteLength > REPORT_MAX_BYTES) {
      await reader.cancel().catch(() => {})
      return 'too_large'
    }
    bytes.set(value, size)
    size += value.byteLength
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size))
  } catch {
    return null
  }
}
