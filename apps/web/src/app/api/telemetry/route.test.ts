import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { POST } from './route'

// The error report route, in Node: what it logs, and everything it refuses. It reads no session,
// cookie, D1 or R2, so it needs no workerd (every-route.workers.test.ts skips it).

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
      // A stream body needs it in Node.
      duplex: 'half'
    } as RequestInit)
  )
}

let logged: MockInstance<(...args: unknown[]) => void>

beforeEach(() => {
  logged = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
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
      new Request('https://pedos.app/api/telemetry/', {
        method: 'POST',
        headers: { origin: 'https://pedos.app', 'content-type': 'application/json' },
        body: JSON.stringify({ ...report, environment: 'production' })
      })
    )
    expect(own.status).toBe(204)
    expect(JSON.parse(String(logged.mock.calls[0]?.[0]))).toMatchObject({
      environment: 'production',
      workerEnvironment: 'production'
    })
    const staging = await POST(
      new Request('https://pedos.app/api/telemetry/', {
        method: 'POST',
        headers: { origin: 'https://staging.pedos.app', 'content-type': 'application/json' },
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
})
