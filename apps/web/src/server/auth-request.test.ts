import { describe, expect, it } from 'vitest'

import {
  answer,
  get,
  LOCAL,
  post,
  type Sent,
  STAGING,
  STAGING_WORKERS_DEV,
  signInHarness
} from '@/test-support/sign-in'

import {
  AUTH_ENDPOINTS,
  GET_SESSION_ENDPOINT,
  SEND_CODE_ENDPOINT,
  SIGN_OUT_ENDPOINT
} from './auth-endpoints'
import { AUTH_MAX_BYTES, serveAuthRequest } from './auth-request'
import { readSessionUser } from './auth-session'

const harness = signInHarness()
const { local, staging, mailCount, rows } = harness

type Routable = { path?: string; options?: { method?: string | string[] } }

function registeredRoutes(api: object): { methods: string[]; path: string }[] {
  return Object.values(api as Record<string, Routable>).flatMap(endpoint =>
    endpoint.path && endpoint.options?.method
      ? [
          {
            methods: [endpoint.options.method].flat().map(method => method.toUpperCase()),
            path: endpoint.path
          }
        ]
      : []
  )
}

describe('the endpoints', () => {
  it('serves only the four, of every route Better Auth registers', async () => {
    const routes = registeredRoutes(harness.offlineAuth().api)
    expect(routes.length).toBeGreaterThan(20)
    for (const endpoint of AUTH_ENDPOINTS) {
      expect(routes.find(route => route.path === endpoint.path)?.methods).toContain(endpoint.method)
    }
    const paths = [
      ...routes.map(route => route.path),
      '',
      '/',
      '/GET-SESSION',
      '/get-session//',
      '/../get-session',
      '/email-otp/send-verification-otp/x'
    ]
    const served: string[] = []
    for (const path of paths) {
      for (const suffix of ['', '/']) {
        for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
          const routed = AUTH_ENDPOINTS.some(e => e.method === method && e.path === path)
          if (routed) continue
          const request = new Request(`${LOCAL}/api/auth${path}${suffix}`, {
            method,
            headers: { origin: LOCAL, 'content-type': 'application/json' },
            body: method === 'GET' ? undefined : '{}'
          })
          const response = await serveAuthRequest(request, local())
          if (response.status !== 404) served.push(`${method} ${path}${suffix}: ${response.status}`)
        }
      }
    }
    expect(served).toEqual([])
  })

  it('serves the four, with or without a trailing slash, never cached', async () => {
    for (const [index, suffix] of ['', '/'].entries()) {
      const session = await serveAuthRequest(get(`${GET_SESSION_ENDPOINT}${suffix}`), local())
      expect(session.status).toBe(200)
      expect(await session.json()).toBeNull()
      expect(session.headers.get('cache-control')).toBe('private, no-store')
      const sent = await serveAuthRequest(
        post(`${SEND_CODE_ENDPOINT}${suffix}`, {
          email: `fan${index}@example.com`,
          type: 'sign-in'
        }),
        local()
      )
      expect(await answer(sent)).toEqual({ status: 200, body: { success: true } })
      expect(sent.headers.get('cache-control')).toBe('private, no-store')
    }
    const missing = await serveAuthRequest(get('/ok'), local())
    expect(await answer(missing)).toEqual({
      status: 404,
      body: { code: 'NOT_FOUND', message: 'Not found.' }
    })
    expect(missing.headers.get('cache-control')).toBe('private, no-store')
  })
})

describe('a body', () => {
  it('is refused over AUTH_MAX_BYTES', async () => {
    expect(AUTH_MAX_BYTES).toBe(16 * 1024)
    const padded = { email: 'fan@example.com', type: 'sign-in', pad: 'x'.repeat(AUTH_MAX_BYTES) }
    const response = await serveAuthRequest(post(SEND_CODE_ENDPOINT, padded), local())
    expect(await answer(response)).toMatchObject({
      status: 413,
      body: { code: 'PAYLOAD_TOO_LARGE' }
    })
  })

  function streamed(chunks: number, headers: Record<string, string> = {}) {
    const seen = { pulls: 0, cancelled: false }
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        seen.pulls++
        if (seen.pulls > chunks) controller.close()
        else controller.enqueue(new TextEncoder().encode(' '.repeat(1024)))
      },
      cancel() {
        seen.cancelled = true
      }
    })
    const request = new Request(`${LOCAL}/api/auth${SEND_CODE_ENDPOINT}`, {
      method: 'POST',
      headers: { origin: LOCAL, 'content-type': 'application/json', ...headers },
      body,
      duplex: 'half'
    } as RequestInit)
    return { request, seen }
  }

  it('is refused by its Content-Length, before any of it is read', async () => {
    const { request, seen } = streamed(1, { 'content-length': String(AUTH_MAX_BYTES + 1) })
    expect(request.headers.get('content-length')).toBe(String(AUTH_MAX_BYTES + 1))
    const response = await serveAuthRequest(request, local())
    expect(await answer(response)).toMatchObject({
      status: 413,
      body: { code: 'PAYLOAD_TOO_LARGE' }
    })
    expect(seen.pulls).toBeLessThanOrEqual(1)
    expect(seen.cancelled).toBe(true)
  })

  it('with no length stops being read once it passes AUTH_MAX_BYTES', async () => {
    const { request, seen } = streamed(1000)
    expect(request.headers.get('content-length')).toBeNull()
    const response = await serveAuthRequest(request, local())
    expect(await answer(response)).toMatchObject({
      status: 413,
      body: { code: 'PAYLOAD_TOO_LARGE' }
    })
    expect(seen.cancelled).toBe(true)
    expect(seen.pulls).toBeLessThan(AUTH_MAX_BYTES / 1024 + 4)
  })
})

describe('writes from anywhere but the site', () => {
  const body = { email: 'fan@example.com', type: 'sign-in' }
  const refused = async (request: Request, env = local()) => {
    const response = await serveAuthRequest(request, env)
    return { status: response.status, code: ((await response.json()) as { code: string }).code }
  }

  it('are refused by Origin, Sec-Fetch-Site and content type', async () => {
    expect(
      await refused(post(SEND_CODE_ENDPOINT, body, { origin: 'https://evil.example' }))
    ).toEqual({ status: 403, code: 'INVALID_ORIGIN' })
    expect(await refused(post(SEND_CODE_ENDPOINT, body, { origin: null }))).toEqual({
      status: 403,
      code: 'INVALID_ORIGIN'
    })
    expect(
      await refused(post(SEND_CODE_ENDPOINT, body, { origin: 'http://localhost:9999' }))
    ).toEqual({ status: 403, code: 'INVALID_ORIGIN' })
    for (const site of ['cross-site', 'same-site', 'none']) {
      const request = post(SEND_CODE_ENDPOINT, body, { headers: { 'sec-fetch-site': site } })
      expect(await refused(request)).toEqual({ status: 403, code: 'CROSS_SITE_REQUEST' })
    }
    const form = post(SEND_CODE_ENDPOINT, body, { headers: { 'content-type': 'text/plain' } })
    expect(await refused(form)).toEqual({ status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' })
    expect(await mailCount('fan@example.com')).toBe(0)
    expect(await rows('SELECT key FROM rate_limit')).toEqual([])

    const sameOrigin = post(SEND_CODE_ENDPOINT, body, {
      headers: { 'sec-fetch-site': 'same-origin' }
    })
    expect((await serveAuthRequest(sameOrigin, local())).status).toBe(200)
  })

  it('are refused on Staging unless they come from its own origin', async () => {
    const sent: Sent = []
    const own = post(SEND_CODE_ENDPOINT, body, { base: STAGING_WORKERS_DEV, origin: STAGING })
    expect((await serveAuthRequest(own, staging(sent))).status).toBe(200)
    const other = post(SEND_CODE_ENDPOINT, body, {
      base: STAGING_WORKERS_DEV,
      origin: STAGING_WORKERS_DEV
    })
    expect(await refused(other, staging(sent))).toEqual({ status: 403, code: 'INVALID_ORIGIN' })
  })

  it('are also refused by Better Auth’s own checks, forced on under NODE_ENV=test', async () => {
    expect(process.env.NODE_ENV).toBe('test')
    const cookie = await harness.signIn('fan@example.com')
    const request = post(SIGN_OUT_ENDPOINT, {}, { origin: 'https://evil.example', cookie })
    const response = await harness.offlineAuth().handler(request)
    expect(response.status).toBe(403)
    expect(await readSessionUser(new Request(LOCAL, { headers: { cookie } }), local())).not.toBe(
      null
    )
  })
})
