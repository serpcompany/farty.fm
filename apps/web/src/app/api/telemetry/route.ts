import { getCloudflareContext } from '@opennextjs/cloudflare'
import { servedOrigin, siteEnv } from '@/lib/site'
import { parseReport, REPORT_MAX_BYTES } from '@/lib/telemetry/report'
import { apiError, readCapped } from '@/server/http'

export async function POST(request: Request): Promise<Response> {
  if (!(await withinLimit(request))) return refuse(429, 'rate_limited')
  if (request.headers.get('origin') !== servedOrigin(request)) return refuse(403, 'cross_origin')
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return refuse(415, 'not_json')
  }
  const body = await readCapped(request, REPORT_MAX_BYTES)
  if (body === null) return refuse(413, 'too_large')
  const report = parseReport(jsonOf(body))
  if (!report) return refuse(400, 'bad_report')
  console.error(JSON.stringify({ event: 'client_error', ...report, workerEnvironment: siteEnv() }))
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
}

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
  const response = apiError(status, error)
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function jsonOf(utf8: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(utf8))
  } catch {
    return null
  }
}
