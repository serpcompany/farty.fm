import { AUTH_BASE_PATH, isTurnstileKeyRequest, servedEndpoint } from './auth-endpoints'
import { type AuthEnv, type AuthSettings, availableAuthSettings } from './auth-settings'
import { authFor } from './create-auth'
import { isLocalHost } from './environment'
import { readCapped } from './http'

export const AUTH_MAX_BYTES = 16 * 1024

function failure(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, { status })
}

const authUnavailable = () => failure(503, 'AUTH_UNAVAILABLE', 'Sign-in isn’t available right now.')

function turnstileSiteKey(env: AuthEnv): Response {
  const settings = availableAuthSettings(env)
  if (!settings) return authUnavailable()
  if (!settings.turnstile) {
    return failure(503, 'TURNSTILE_UNAVAILABLE', 'Sign-in codes can’t be sent here.')
  }
  return Response.json({ siteKey: settings.turnstile.siteKey })
}

function crossSiteRefusal(request: Request, settings: AuthSettings): Response | null {
  const site = request.headers.get('sec-fetch-site')
  if (site !== null && site !== 'same-origin') {
    return failure(403, 'CROSS_SITE_REQUEST', 'Requests must come from this site.')
  }
  const url = new URL(request.url)
  const expected = settings.writeOrigin ?? (isLocalHost(url.host) ? url.origin : null)
  if (expected === null || request.headers.get('origin') !== expected) {
    return failure(403, 'INVALID_ORIGIN', 'Requests must come from this site.')
  }
  const type = request.headers.get('content-type') ?? ''
  if (!/^application\/json\s*(;|$)/i.test(type)) {
    return failure(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send JSON.')
  }
  return null
}

function noStore(response: Response): Response {
  const stored = new Response(response.body, response)
  stored.headers.set('cache-control', 'private, no-store')
  return stored
}

async function forwardedBody(
  request: Request,
  settings: AuthSettings
): Promise<Uint8Array<ArrayBuffer> | Response | undefined> {
  if (request.method !== 'POST') return undefined
  const refused = crossSiteRefusal(request, settings)
  if (refused) return refused
  const body = await readCapped(request, AUTH_MAX_BYTES)
  return body ?? failure(413, 'PAYLOAD_TOO_LARGE', 'That request is too large.')
}

export async function serveAuthRequest(request: Request, env: AuthEnv): Promise<Response> {
  const url = new URL(request.url)
  if (isTurnstileKeyRequest(request.method, url.pathname)) return noStore(turnstileSiteKey(env))
  const path = servedEndpoint(request.method, url.pathname)
  if (path === null) return noStore(failure(404, 'NOT_FOUND', 'Not found.'))
  const built = authFor(request, env)
  if (!built) return noStore(authUnavailable())
  const body = await forwardedBody(request, built.settings)
  if (body instanceof Response) return noStore(body)
  const headers = new Headers(request.headers)
  if (body) headers.delete('content-length')
  const forwardedUrl = new URL(`${AUTH_BASE_PATH}${path}${url.search}`, url)
  const forwarded = new Request(forwardedUrl, { method: request.method, headers, body })
  return noStore(await built.auth.handler(forwarded))
}
