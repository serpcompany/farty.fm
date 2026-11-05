import { getCloudflareContext } from '@opennextjs/cloudflare'

import { servedOrigin } from '@/lib/site'

// What the routes anyone can call without a session and that count what a browser reports share
// (`api/telemetry/`, `api/steps/`): the checks a report passes before anyone reads it.

/** An answer that's never cached. */
export function refuse(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } })
}

/**
 * The request's body as UTF-8, null when it isn't UTF-8, or the refusal: a client over
 * `TELEMETRY_RATE_LIMIT` (429, 30 a minute per `cf-connecting-ip`, `wrangler.jsonc`), another origin
 * (403), anything but JSON (415), or a body over `maxBytes` (413).
 */
export async function readTelemetryRequest(
  request: Request,
  maxBytes: number
): Promise<string | null | Response> {
  if (!(await withinLimit(request))) return refuse(429, 'rate_limited')
  if (request.headers.get('origin') !== servedOrigin(request)) return refuse(403, 'cross_origin')
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return refuse(415, 'not_json')
  }
  const body = await readBody(request, maxBytes)
  return body === 'too_large' ? refuse(413, 'too_large') : body
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

/** The body as UTF-8, read no further than the limit; null when it isn't UTF-8. */
async function readBody(request: Request, maxBytes: number): Promise<string | 'too_large' | null> {
  if (Number(request.headers.get('content-length') ?? 0) > maxBytes) return 'too_large'
  if (!request.body) return null
  const reader = request.body.getReader()
  const bytes = new Uint8Array(maxBytes)
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (size + value.byteLength > maxBytes) {
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
