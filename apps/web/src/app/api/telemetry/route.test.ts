import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { POST } from './route'

type Limiter = { limit(options: { key: string }): Promise<{ success: boolean }> }
const cloudflare = vi.hoisted(() => ({
  env: {} as { TELEMETRY_RATE_LIMIT?: Limiter } | null
}))
vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => {
    if (!cloudflare.env) throw new Error('no Cloudflare context')
    return { env: cloudflare.env }
  }
}))

function fakeLimit(limit: number): Limiter & { keys: string[] } {
  const counts = new Map<string, number>()
  const keys: string[] = []
  return {
    keys,
    async limit({ key }) {
      keys.push(key)
      const count = (counts.get(key) ?? 0) + 1
      counts.set(key, count)
      return { success: count <= limit }
    }
  }
}

const ORIGIN = 'http://localhost:3202'
const PATH = `${ORIGIN}/api/telemetry/`

const report = {
  code: 'toot-make-failed',
  name: 'TypeError',
  screen: 'compose',
  release: '1.2.0+1bb4403',
  environment: 'staging',
  delaySeconds: 0
}

function post(body: BodyInit | null, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new Request(PATH, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
      body,
      duplex: 'half'
    } as RequestInit)
  )
}

let logged: MockInstance<(...args: unknown[]) => void>

beforeEach(() => {
  logged = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cloudflare.env = {}
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('POST /api/telemetry/', () => {
  it('logs one JSON line with the report, and answers 204, no-store', async () => {
    const response = await post(JSON.stringify(report), { cookie: 'session=abc' })
    expect(response.status).toBe(204)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(logged).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(logged.mock.calls[0]?.[0]))).toEqual({
      event: 'client_error',
      ...report,
      workerEnvironment: 'local'
    })
    expect(String(logged.mock.calls[0]?.[0])).not.toContain('session=abc')
  })

  it("names the Worker's environment, and takes only its own origin there", async () => {
    vi.stubEnv('SITE_ENV', 'production')
    const own = await POST(
      new Request('https://farty.fm/api/telemetry/', {
        method: 'POST',
        headers: { origin: 'https://farty.fm', 'content-type': 'application/json' },
        body: JSON.stringify({ ...report, environment: 'production' })
      })
    )
    expect(own.status).toBe(204)
    expect(JSON.parse(String(logged.mock.calls[0]?.[0]))).toMatchObject({
      environment: 'production',
      workerEnvironment: 'production'
    })
    const staging = await POST(
      new Request('https://farty.fm/api/telemetry/', {
        method: 'POST',
        headers: { origin: 'https://staging.farty.fm', 'content-type': 'application/json' },
        body: JSON.stringify(report)
      })
    )
    expect(staging.status).toBe(403)
  })

  it.each<[string, () => Promise<Response>, number, string]>([
    [
      'another origin',
      () => post(JSON.stringify(report), { origin: 'https://evil.example' }),
      403,
      'cross_origin'
    ],
    ['no origin', () => post(JSON.stringify(report), { origin: '' }), 403, 'cross_origin'],
    [
      'anything but JSON',
      () => post(JSON.stringify(report), { 'content-type': 'text/plain' }),
      415,
      'not_json'
    ],
    [
      'a body over 1 KB',
      () => post(JSON.stringify({ ...report, padding: 'x'.repeat(1100) })),
      413,
      'too_large'
    ],
    [
      'a body over 1 KB that says it is small',
      () => post(new Blob([JSON.stringify({ ...report, padding: 'x'.repeat(1100) })]).stream(), {}),
      413,
      'too_large'
    ],
    ['an unknown code', () => post(JSON.stringify({ ...report, code: 'nope' })), 400, 'bad_report'],
    [
      'an extra field',
      () => post(JSON.stringify({ ...report, message: 'test@example.com' })),
      400,
      'bad_report'
    ],
    [
      'an email for a name',
      () => post(JSON.stringify({ ...report, name: 'test@example.com' })),
      400,
      'bad_report'
    ],
    ['a body that is not JSON', () => post('{"code":'), 400, 'bad_report'],
    ['a body that is not UTF-8', () => post(new Uint8Array([0xff, 0xfe, 0xfd])), 400, 'bad_report'],
    ['no body', () => post(null), 400, 'bad_report']
  ])('refuses %s, and logs nothing', async (_, send, status, error) => {
    const response = await send()
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ error })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(logged).not.toHaveBeenCalled()
  })

  it('answers a client over 30 a minute 429, and logs nothing for it', async () => {
    const limiter = fakeLimit(30)
    cloudflare.env = { TELEMETRY_RATE_LIMIT: limiter }
    const from = (ip: string) => post(JSON.stringify(report), { 'cf-connecting-ip': ip })
    for (let i = 0; i < 30; i++) expect((await from('203.0.113.7')).status).toBe(204)
    expect(logged).toHaveBeenCalledTimes(30)

    const over = await from('203.0.113.7')
    expect(over.status).toBe(429)
    expect(await over.json()).toEqual({ error: 'rate_limited' })
    expect(over.headers.get('cache-control')).toBe('no-store')
    expect(logged).toHaveBeenCalledTimes(30)

    expect((await from('198.51.100.2')).status).toBe(204)
    expect(limiter.keys.at(-1)).toBe('198.51.100.2')
  })

  it('takes every report without the binding, or without a Cloudflare context', async () => {
    cloudflare.env = {}
    expect((await post(JSON.stringify(report))).status).toBe(204)
    cloudflare.env = null
    expect((await post(JSON.stringify(report))).status).toBe(204)
  })
})
