import { timingSafeEqual } from 'node:crypto'

export const stagingAccessChallenge = 'Basic realm="farty staging", charset="UTF-8"'
export const environmentNoindex = 'noindex, nofollow'
export const smokeTestHeader = 'x-pedos-smoke-test'

const servedWithoutThePassword = new Set(['/robots.txt'])
const postedWithoutThePassword = new Set(['/api/stripe/webhook/'])
const fixturesNeedThePassword = /\/fixtures(\/|$)/iu

export interface EntryEnv {
  SITE_ENV?: string
  STAGING_BASIC_AUTH_PASSWORD?: string
  ASSETS?: { fetch(request: Request): Promise<Response> }
}

type StagingAccess =
  | { gate: 'exempt' }
  | { gate: 'passed'; request: Request }
  | { gate: 'refused'; response: Response }

export function basicAuthPassword(header: string | null): string | null {
  const encoded = /^basic[ \t]+([A-Za-z0-9+/]+={0,2})[ \t]*$/iu.exec(header ?? '')?.[1]
  if (!encoded) return null
  let binary: string
  try {
    binary = atob(encoded)
  } catch {
    return null
  }
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  const credentials = new TextDecoder().decode(bytes)
  const separator = credentials.indexOf(':')
  return separator === -1 ? null : credentials.slice(separator + 1)
}

function sha256(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
}

export async function passwordMatches(given: string, expected: string): Promise<boolean> {
  const [givenDigest, expectedDigest] = await Promise.all([sha256(given), sha256(expected)])
  return timingSafeEqual(new Uint8Array(givenDigest), new Uint8Array(expectedDigest))
}

function refusal(request: Request): Response {
  return new Response(request.method === 'HEAD' ? null : 'Staging asks for a password.\n', {
    status: 401,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'WWW-Authenticate': stagingAccessChallenge,
      'X-Robots-Tag': environmentNoindex
    }
  })
}

function isServedWithoutThePassword(request: Request, url: URL): boolean {
  if (request.method === 'POST') return postedWithoutThePassword.has(url.pathname)
  if (!servedWithoutThePassword.has(url.pathname)) return false
  return request.method === 'GET' || request.method === 'HEAD'
}

function isTheFixtureLibrary(url: URL): boolean {
  let path: string
  try {
    path = decodeURIComponent(url.pathname)
  } catch {
    return true
  }
  return fixturesNeedThePassword.test(path.replaceAll('\\', '/'))
}

function withoutAuthorization(request: Request): Request {
  const headers = new Headers(request.headers)
  headers.delete('Authorization')
  return new Request(request, { headers })
}

async function stagingAccess(
  request: Request,
  url: URL,
  password: string | undefined
): Promise<StagingAccess> {
  if (isServedWithoutThePassword(request, url)) return { gate: 'exempt' }
  const authorization = request.headers.get('Authorization')
  if (authorization === null && request.headers.has(smokeTestHeader) && !isTheFixtureLibrary(url)) {
    return { gate: 'exempt' }
  }
  const given = basicAuthPassword(authorization)
  if (password && given !== null && (await passwordMatches(given, password))) {
    return { gate: 'passed', request: withoutAuthorization(request) }
  }
  return { gate: 'refused', response: refusal(request) }
}

function withEnvironmentNoindex(response: Response): Response {
  const headers = new Headers(response.headers)
  headers.set('X-Robots-Tag', environmentNoindex)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}

export async function behindStagingAccess(
  request: Request,
  url: URL,
  password: string | undefined,
  serve: (request: Request) => Promise<Response>
): Promise<Response> {
  const access = await stagingAccess(request, url, password)
  if (access.gate === 'refused') return access.response
  if (access.gate === 'passed') return serve(access.request)
  return withEnvironmentNoindex(await serve(request))
}

async function assetOrPage(
  request: Request,
  assets: EntryEnv['ASSETS'],
  page: (request: Request) => Promise<Response>
): Promise<Response> {
  if (assets && (request.method === 'GET' || request.method === 'HEAD')) {
    const asset = await assets.fetch(request)
    if (asset.status !== 404) return asset
    await asset.body?.cancel()
  }
  return page(request)
}

export function servedByTheEntry(
  request: Request,
  env: EntryEnv,
  page: (request: Request) => Promise<Response>
): Promise<Response> {
  if (env.SITE_ENV === 'production') return page(request)
  const serve = (forwarded: Request) => assetOrPage(forwarded, env.ASSETS, page)
  return behindStagingAccess(request, new URL(request.url), env.STAGING_BASIC_AUTH_PASSWORD, serve)
}
