import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDatabase } from '@/db/database'
import { type LocalBindings, localBindings } from '@/test-support/local-bindings'
import { fakeSiteverify, siteverifyCalls, TEST_TOKEN } from '@/test-support/turnstile'

import {
  AUTH_ENDPOINTS,
  AUTH_MAX_BYTES,
  type AuthEnv,
  AuthUnavailableError,
  authRoutes,
  clientLimitKey,
  consumeSlot,
  createAuth,
  GET_SESSION_ENDPOINT,
  hashSignInCode,
  readSessionUser,
  resolveAuthSettings,
  SEND_CODE_ENDPOINT,
  SESSION_EXPIRES_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
  SIGN_IN_ENDPOINT,
  SIGN_OUT_ENDPOINT,
  SITE_CODES_KEY,
  serveAuthRequest,
  TURNSTILE_ENDPOINT,
  TURNSTILE_TEST_SECRET_KEY,
  TURNSTILE_TEST_SITE_KEY
} from './auth-config'
import { listCapturedEmails } from './dev-mailbox'
import {
  createEmailSender,
  SIGN_IN_CODE_ATTEMPTS,
  SIGN_IN_CODE_LENGTH,
  SIGN_IN_CODE_MINUTES
} from './email'

// Sign-in on a real local D1 and dev mailbox (src/test-support/local-bindings.ts), through the
// same `serveAuthRequest` the route serves. Each test starts from empty tables.

const LOCAL = 'http://localhost:3115'
const STAGING = 'https://staging.farty.fm'
const SECRET = 'a-test-secret-that-is-long-enough-0123456789'

let bindings: LocalBindings
beforeAll(async () => {
  bindings = await localBindings()
})
afterAll(() => bindings.dispose())
beforeEach(async () => {
  await bindings.reset()
  // Each sign-in logs what happened; the tests read the outcomes, not the lines.
  for (const level of ['info', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation(() => {})
  }
  fakeSiteverify()
  return () => vi.restoreAllMocks()
})

const local = (extra: Partial<AuthEnv> = {}): AuthEnv => ({
  DB: bindings.DB,
  DEV_MAILBOX: bindings.DEV_MAILBOX,
  BETTER_AUTH_SECRET: SECRET,
  ...extra
})

type Sent = EmailMessageBuilder[]
const staging = (sent: Sent, extra: Partial<AuthEnv> = {}): AuthEnv => ({
  SITE_ENV: 'staging',
  DB: bindings.DB,
  EMAIL: {
    async send(message: EmailMessageBuilder) {
      sent.push(message)
      return { messageId: 'test' }
    }
  },
  EMAIL_FROM: 'Farty <support@farty.fm>',
  BETTER_AUTH_URL: STAGING,
  BETTER_AUTH_SECRET: SECRET,
  STAGING_SIGNUP_ALLOWLIST: 'member@example.com',
  TURNSTILE_SITE_KEY: 'staging-site-key',
  TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET_KEY,
  ...extra
})

type RequestOptions = {
  base?: string
  origin?: string | null
  ip?: string
  cookie?: string
  /** The Turnstile token, `TEST_TOKEN` unless it's given; null sends none. */
  captcha?: string | null
  headers?: Record<string, string>
}

function post(path: string, body: unknown, options: RequestOptions = {}): Request {
  const { base = LOCAL, origin = base, ip = '203.0.113.1', cookie, headers = {} } = options
  const { captcha = TEST_TOKEN } = options
  const all = new Headers({
    'content-type': 'application/json',
    'cf-connecting-ip': ip,
    ...headers
  })
  if (origin !== null) all.set('origin', origin)
  if (cookie) all.set('cookie', cookie)
  if (captcha !== null) all.set('x-captcha-response', captcha)
  return new Request(`${base}/api/auth${path}`, {
    method: 'POST',
    headers: all,
    body: JSON.stringify(body)
  })
}

function get(path: string, { base = LOCAL, cookie, ip = '203.0.113.1' }: RequestOptions = {}) {
  const headers = new Headers({ 'cf-connecting-ip': ip })
  if (cookie) headers.set('cookie', cookie)
  return new Request(`${base}/api/auth${path}`, { headers })
}

const sendCode = (env: AuthEnv, email: string, options?: RequestOptions) =>
  serveAuthRequest(post(SEND_CODE_ENDPOINT, { email, type: 'sign-in' }, options), env)

const trySignIn = (env: AuthEnv, email: string, otp: string, options?: RequestOptions) =>
  serveAuthRequest(post(SIGN_IN_ENDPOINT, { email, otp }, options), env)

/** The code in the newest email to `to`: the one line that is only digits. */
async function mailedCode(to: string): Promise<string> {
  const email = (await listCapturedEmails(bindings.DEV_MAILBOX)).find(mail => mail.to === to)
  const code = email?.text.split('\n').find(line => /^\d+$/.test(line))
  if (!code) throw new Error(`No code was mailed to ${to}`)
  return code
}

async function mailCount(to: string): Promise<number> {
  return (await listCapturedEmails(bindings.DEV_MAILBOX)).filter(mail => mail.to === to).length
}

/** The session cookie a response sets, as a `Cookie` header. */
function sessionCookie(response: Response): string {
  return response.headers
    .getSetCookie()
    .map(cookie => cookie.split(';')[0])
    .filter(cookie => cookie.includes('session_token'))
    .join('; ')
}

/** Signs in locally through the dev mailbox, and answers the session cookie. */
async function signIn(email: string, options?: RequestOptions): Promise<string> {
  expect((await sendCode(local(), email, options)).status).toBe(200)
  const response = await trySignIn(local(), email, await mailedCode(email.toLowerCase()), options)
  expect(response.status).toBe(200)
  return sessionCookie(response)
}

async function answer(response: Response) {
  return { status: response.status, body: await response.json() }
}

const rows = async <T>(sql: string, ...values: unknown[]) =>
  (
    await bindings.DB.prepare(sql)
      .bind(...values)
      .all<T>()
  ).results

/** The `auth_site_code_limit` lines logged in this test. */
const siteLimitLines = () =>
  vi
    .mocked(console.warn)
    .mock.calls.map(([line]) => String(line))
    .filter(line => line.startsWith('auth_site_code_limit '))

describe('the endpoints', () => {
  it('serves only the four, of every route Better Auth registers', async () => {
    const resolved = resolveAuthSettings(local())
    if (!resolved.ok) throw new Error(resolved.reason)
    const auth = createAuth({
      db: createDatabase(bindings.DB),
      settings: resolved.settings,
      email: createEmailSender({ kind: 'off', reason: 'email_not_configured' })
    })
    const routes = authRoutes(auth)
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

describe('local sign-in', () => {
  it('signs in with the mailed code, reads the session from D1, and signs out', async () => {
    const cookie = await signIn('Fan@Example.com')
    const session = await serveAuthRequest(get(GET_SESSION_ENDPOINT, { cookie }), local())
    const { user } = (await session.json()) as { user: Record<string, unknown> }
    expect(user).toMatchObject({
      email: 'fan@example.com',
      emailVerified: true,
      marketingEmail: true
    })

    const request = new Request(LOCAL, { headers: { cookie } })
    expect(await readSessionUser(request, local())).toEqual({
      id: user.id,
      email: 'fan@example.com',
      marketingEmail: true
    })
    expect(await rows('SELECT marketing_email FROM user')).toEqual([{ marketing_email: 1 }])

    const out = await serveAuthRequest(post(SIGN_OUT_ENDPOINT, {}, { cookie }), local())
    expect(out.status).toBe(200)
    expect(await readSessionUser(request, local())).toBeNull()
    expect(await rows('SELECT id FROM session')).toEqual([])
  })

  it('reads no session without a cookie, or with a forged one', async () => {
    await signIn('fan@example.com')
    const none = new Request(LOCAL)
    const forged = new Request(LOCAL, { headers: { cookie: 'pedos.session_token=abc.def' } })
    expect(await readSessionUser(none, local())).toBeNull()
    expect(await readSessionUser(forged, local())).toBeNull()
  })

  it('reads the session from D1 every time, with no cookie cache', async () => {
    await sendCode(local(), 'fan@example.com')
    const response = await trySignIn(
      local(),
      'fan@example.com',
      await mailedCode('fan@example.com')
    )
    // Every cookie sign-in set, so a cached session would be read back if there were one.
    const cookies = response.headers.getSetCookie().map(set => set.split(';')[0])
    expect(cookies.map(set => set.split('=')[0])).toEqual(['pedos.session_token'])
    const cookie = cookies.join('; ')
    const request = new Request(LOCAL, { headers: { cookie } })
    expect(await readSessionUser(request, local())).not.toBeNull()
    await bindings.DB.prepare('DELETE FROM session').run()
    expect(await readSessionUser(request, local())).toBeNull()
    const session = await serveAuthRequest(get(GET_SESSION_ENDPOINT, { cookie }), local())
    expect(await session.json()).toBeNull()
  })

  it('keeps a session 7 days, moved on when read a day or more after', async () => {
    expect([SESSION_EXPIRES_SECONDS, SESSION_UPDATE_AGE_SECONDS]).toEqual([7 * 86_400, 86_400])
    const week = 7 * 86_400_000
    const before = Date.now()
    const cookie = await signIn('fan@example.com')
    const expiry = async () =>
      (await rows<{ expires_at: number }>('SELECT expires_at FROM session'))[0].expires_at
    expect(await expiry()).toBeGreaterThanOrEqual(before + week)
    expect(await expiry()).toBeLessThanOrEqual(Date.now() + week)
    const age = (ms: number) =>
      bindings.DB.prepare('UPDATE session SET expires_at = expires_at - ?').bind(ms).run()
    const request = new Request(LOCAL, { headers: { cookie } })

    // Under a day old: left as it is.
    await age(23 * 3_600_000)
    const kept = await expiry()
    expect(await readSessionUser(request, local())).not.toBeNull()
    expect(await expiry()).toBe(kept)

    // Two days old: getSessionUser moves it on in D1 only.
    await age(25 * 3_600_000)
    const reading = Date.now()
    expect(await readSessionUser(request, local())).not.toBeNull()
    expect(await expiry()).toBeGreaterThanOrEqual(reading + week)

    // The client's get-session moves it on and sets the cookie again, for 7 days.
    await age(2 * 86_400_000)
    const session = await serveAuthRequest(get(GET_SESSION_ENDPOINT, { cookie }), local())
    expect(session.status).toBe(200)
    const set = session.headers.getSetCookie().find(line => line.includes('session_token'))
    expect(set).toMatch(/Max-Age=604800/)
  })

  it('keeps no IP address or user agent with a session', async () => {
    await signIn('fan@example.com', { headers: { 'user-agent': 'Mozilla/5.0 Test' } })
    expect(await rows('SELECT ip_address, user_agent FROM session')).toEqual([
      { ip_address: null, user_agent: null }
    ])
  })

  it('refuses any field but email and otp, or email and type, and any code type but sign-in', async () => {
    const extra = await serveAuthRequest(
      post(SIGN_IN_ENDPOINT, { email: 'fan@example.com', otp: '123456', name: 'Fan' }),
      local()
    )
    expect(await answer(extra)).toMatchObject({ status: 400, body: { code: 'FIELD_NOT_ALLOWED' } })
    // Better Auth's own schema drops unknown fields here, rather than refusing them.
    const extraSend = await serveAuthRequest(
      post(SEND_CODE_ENDPOINT, { email: 'fan@example.com', type: 'sign-in', name: 'Fan' }),
      local()
    )
    expect(await answer(extraSend)).toMatchObject({
      status: 400,
      body: { code: 'FIELD_NOT_ALLOWED' }
    })
    const reset = await serveAuthRequest(
      post(SEND_CODE_ENDPOINT, { email: 'fan@example.com', type: 'forget-password' }),
      local()
    )
    expect(await answer(reset)).toMatchObject({
      status: 400,
      body: { code: 'UNSUPPORTED_OTP_TYPE' }
    })
    expect(await mailCount('fan@example.com')).toBe(0)
  })

  it('refuses a body over AUTH_MAX_BYTES', async () => {
    expect(AUTH_MAX_BYTES).toBe(16 * 1024)
    const padded = { email: 'fan@example.com', type: 'sign-in', pad: 'x'.repeat(AUTH_MAX_BYTES) }
    const response = await serveAuthRequest(post(SEND_CODE_ENDPOINT, padded), local())
    expect(await answer(response)).toMatchObject({
      status: 413,
      body: { code: 'PAYLOAD_TOO_LARGE' }
    })
  })

  /** A body that streams `chunks` KB, and what reading it did. */
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

  it('refuses a body by its Content-Length, before reading any of it', async () => {
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

  it('stops reading a body with no length once it passes AUTH_MAX_BYTES', async () => {
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

  it('refuses a code request for a missing or malformed email itself', async () => {
    for (const body of [{ type: 'sign-in' }, { email: 'not-an-email', type: 'sign-in' }]) {
      const response = await serveAuthRequest(post(SEND_CODE_ENDPOINT, body), local())
      expect(await answer(response)).toEqual({
        status: 400,
        body: { code: 'INVALID_EMAIL', message: 'Enter a valid email address.' }
      })
    }
    expect(await listCapturedEmails(bindings.DEV_MAILBOX)).toEqual([])
  })

  it('refuses a code request when email goes nowhere', async () => {
    const response = await sendCode(local({ DEV_MAILBOX: undefined }), 'fan@example.com')
    expect(await answer(response)).toMatchObject({
      status: 503,
      body: { code: 'OTP_DELIVERY_UNAVAILABLE' }
    })
  })
})

describe('codes', () => {
  it('are six digits in one unbroken run', async () => {
    for (const n of [1, 2, 3, 4, 5]) await sendCode(local(), `fan${n}@example.com`)
    const emails = await listCapturedEmails(bindings.DEV_MAILBOX)
    expect(emails).toHaveLength(5)
    for (const email of emails) {
      const code = await mailedCode(email.to)
      expect(code).toMatch(/^\d{6}$/)
      expect(email.subject).toBe(`${code} is your Farty sign-in code`)
      expect(email.html).toContain(`>${code}</p>`)
    }
  })

  it('sign in when typed with spaces or a dash', async () => {
    await sendCode(local(), 'fan@example.com')
    const code = await mailedCode('fan@example.com')
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`
    expect((await trySignIn(local(), 'fan@example.com', spaced)).status).toBe(200)
    await sendCode(local(), 'fan@example.com')
    const again = await mailedCode('fan@example.com')
    const dashed = `${again.slice(0, 3)}-${again.slice(3)}`
    expect((await trySignIn(local(), 'fan@example.com', dashed)).status).toBe(200)
  })

  it('are stored only as an HMAC under the secret', async () => {
    await sendCode(local(), 'fan@example.com')
    const code = await mailedCode('fan@example.com')
    const [stored] = await rows<{ value: string }>(
      "SELECT value FROM verification WHERE identifier = 'sign-in-otp-fan@example.com'"
    )
    const digest = stored.value.slice(0, stored.value.lastIndexOf(':'))
    expect(digest).not.toContain(code)
    const sha256 = Buffer.from(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code))
    ).toString('base64url')
    expect(digest).not.toBe(sha256)
    expect(digest).toBe(await hashSignInCode(SECRET, code))
  })

  it('are 6 digits, live 10 minutes and allow 3 guesses, defined once', async () => {
    expect([SIGN_IN_CODE_LENGTH, SIGN_IN_CODE_MINUTES, SIGN_IN_CODE_ATTEMPTS]).toEqual([6, 10, 3])
    const before = Date.now()
    await sendCode(local(), 'fan@example.com')
    const after = Date.now()
    const code = await mailedCode('fan@example.com')
    expect(code).toMatch(/^\d{6}$/)
    const [stored] = await rows<{ expires_at: number }>(
      "SELECT expires_at FROM verification WHERE identifier = 'sign-in-otp-fan@example.com'"
    )
    expect(stored.expires_at).toBeGreaterThanOrEqual(before + 10 * 60_000)
    expect(stored.expires_at).toBeLessThanOrEqual(after + 10 * 60_000)
    const wrong = code === '000000' ? '111111' : '000000'
    for (const _ of [1, 2, 3]) {
      const guess = await trySignIn(local(), 'fan@example.com', wrong)
      expect(await answer(guess)).toMatchObject({ status: 400, body: { code: 'INVALID_OTP' } })
    }
    const right = await trySignIn(local(), 'fan@example.com', code)
    expect(right.status).toBe(403)
  })

  it('stop working once they expire', async () => {
    await sendCode(local(), 'fan@example.com')
    const code = await mailedCode('fan@example.com')
    await bindings.DB.prepare('UPDATE verification SET expires_at = ?')
      .bind(Date.now() - 1000)
      .run()
    const late = await trySignIn(local(), 'fan@example.com', code)
    expect(await answer(late)).toMatchObject({ status: 400, body: { code: 'OTP_EXPIRED' } })
    expect(await rows('SELECT id FROM session')).toEqual([])
  })
})

describe('no answer says whether an email has an account', () => {
  it('a code request', async () => {
    await signIn('member@example.com')
    const member = await sendCode(local(), 'member@example.com', { ip: '203.0.113.2' })
    const stranger = await sendCode(local(), 'stranger@example.com', { ip: '203.0.113.2' })
    expect(await answer(member)).toEqual(await answer(stranger))
    expect([...member.headers.keys()]).toEqual([...stranger.headers.keys()])
    expect(await mailCount('member@example.com')).toBe(2)
    expect(await mailCount('stranger@example.com')).toBe(1)
  })

  it('a wrong code, with or without a code sent', async () => {
    await signIn('member@example.com')
    for (const sent of [false, true]) {
      if (sent) {
        await sendCode(local(), 'member@example.com')
        await sendCode(local(), 'stranger@example.com')
      }
      const member = await trySignIn(local(), 'member@example.com', '12345')
      const stranger = await trySignIn(local(), 'stranger@example.com', '12345')
      expect(await answer(member)).toEqual(await answer(stranger))
      expect(member.status).toBe(400)
    }
  })

  it('a code request past a per-email limit, or off Staging’s allowlist', async () => {
    const sent: Sent = []
    const env = staging(sent)
    const ip = (n: number) => ({ base: STAGING, ip: `198.51.100.${n}` })
    const allowed = await sendCode(env, 'member@example.com', ip(1))
    const other = await sendCode(env, 'other@example.com', ip(2))
    expect(await answer(other)).toEqual(await answer(allowed))
    expect(allowed.status).toBe(200)
    for (let n = 2; n <= 5; n++) await sendCode(env, 'member@example.com', ip(1))
    const held = await sendCode(env, 'member@example.com', ip(1))
    expect(await answer(held)).toEqual({ status: 200, body: { success: true } })
    expect([...held.headers.keys()]).toEqual([...allowed.headers.keys()])
    expect(sent.map(message => message.to)).toEqual(Array(5).fill('member@example.com'))
  })
})

describe('rate limits, in D1', () => {
  it('hold code requests at 10 per 10 minutes per client', async () => {
    for (let n = 1; n <= 10; n++) {
      expect((await sendCode(local(), `fan${n}@example.com`)).status).toBe(200)
    }
    const held = await sendCode(local(), 'one-more@example.com')
    expect(held.status).toBe(429)
    expect(Number(held.headers.get('x-retry-after'))).toBeGreaterThan(9 * 60)
    expect(await mailCount('one-more@example.com')).toBe(0)
    const elsewhere = await sendCode(local(), 'one-more@example.com', { ip: '203.0.113.9' })
    expect(elsewhere.status).toBe(200)
    const key = await clientLimitKey(SECRET, `203.0.113.1|${SEND_CODE_ENDPOINT}`)
    expect(await rows('SELECT count FROM rate_limit WHERE key = ?', key)).toEqual([{ count: 10 }])
  })

  it('hold sign-in guesses at 10 a minute per client', async () => {
    for (let n = 1; n <= 10; n++) {
      expect((await trySignIn(local(), `fan${n}@example.com`, '123456')).status).toBe(400)
    }
    expect((await trySignIn(local(), 'fan@example.com', '123456')).status).toBe(429)
  })

  it('hold sign-in guesses at 60 an hour per client', async () => {
    const minute = await clientLimitKey(SECRET, `203.0.113.1|${SIGN_IN_ENDPOINT}`)
    for (let n = 1; n <= 60; n++) {
      expect((await trySignIn(local(), `fan${n}@example.com`, '123456')).status).toBe(400)
      // A minute passes every 10 guesses.
      if (n % 10 === 0)
        await bindings.DB.prepare('DELETE FROM rate_limit WHERE key = ?').bind(minute).run()
    }
    const held = await trySignIn(local(), 'fan@example.com', '123456')
    expect(held.status).toBe(429)
    expect(Number(held.headers.get('x-retry-after'))).toBeGreaterThan(59 * 60)
    const elsewhere = await trySignIn(local(), 'fan@example.com', '123456', { ip: '203.0.113.9' })
    expect(elsewhere.status).toBe(400)
  })

  it('know a client only by cf-connecting-ip, never X-Forwarded-For', async () => {
    for (let n = 1; n <= 10; n++) {
      const spoofed = { headers: { 'x-forwarded-for': `192.0.2.${n}` } }
      expect((await sendCode(local(), `fan${n}@example.com`, spoofed)).status).toBe(200)
    }
    const held = { headers: { 'x-forwarded-for': '192.0.2.99' } }
    expect((await sendCode(local(), 'fan@example.com', held)).status).toBe(429)
  })

  it('count an IPv6 /64 as one client', async () => {
    for (let n = 1; n <= 10; n++) {
      const ip = `2001:db8:1:2::${n.toString(16)}`
      expect((await sendCode(local(), `fan${n}@example.com`, { ip })).status).toBe(200)
    }
    expect(
      (await sendCode(local(), 'fan@example.com', { ip: '2001:db8:1:2:ffff::1' })).status
    ).toBe(429)
    expect((await sendCode(local(), 'fan@example.com', { ip: '2001:db8:1:3::1' })).status).toBe(200)
  })

  it('send an email 5 codes an hour from one client, so one client can’t spend them all', async () => {
    for (let n = 1; n <= 7; n++) {
      const response = await sendCode(local(), 'member@example.com', { ip: '198.51.100.1' })
      expect(await answer(response)).toEqual({ status: 200, body: { success: true } })
    }
    expect(await mailCount('member@example.com')).toBe(5)
    await sendCode(local(), 'member@example.com', { ip: '198.51.100.2' })
    expect(await mailCount('member@example.com')).toBe(6)
  })

  it('send an email 20 codes an hour from every client together', async () => {
    for (let n = 1; n <= 25; n++) {
      const response = await sendCode(local(), 'fan@example.com', { ip: `198.51.100.${n}` })
      expect(await answer(response)).toEqual({ status: 200, body: { success: true } })
    }
    expect(await mailCount('fan@example.com')).toBe(20)
  })

  it('spend per email and client, then per email, then site-wide, which counts only codes that go out', async () => {
    const sent: Sent = []
    const env = staging(sent)
    const ask = async (email: string, client: number, times = 1) => {
      for (let n = 1; n <= times; n++) {
        const response = await sendCode(env, email, { base: STAGING, ip: `198.51.100.${client}` })
        expect(await answer(response)).toEqual({ status: 200, body: { success: true } })
      }
    }
    // One client asks 10 times, Better Auth's most: 5 codes go out, and its other 5 requests
    // spend none of the email's 20...
    await ask('member@example.com', 1, 10)
    expect(sent).toHaveLength(5)
    // ...so three other clients still get the other 15.
    for (const client of [2, 3, 4]) await ask('member@example.com', client, 5)
    expect(sent).toHaveLength(20)
    // Held past the email's 20, and off Staging's allowlist: neither counts site-wide.
    await ask('member@example.com', 5)
    await ask('other@example.com', 6)
    expect(sent).toHaveLength(20)
    expect(await rows('SELECT count FROM rate_limit WHERE key = ?', SITE_CODES_KEY)).toEqual([
      { count: 20 }
    ])
    expect(siteLimitLines()).toEqual([])
  })

  it('send 300 code emails an hour across the site, and log each request that holds', async () => {
    const windowEnds = Date.now() + 30 * 60_000
    await bindings.DB.prepare(
      'INSERT INTO rate_limit (id, key, count, last_request) VALUES (?, ?, ?, ?)'
    )
      .bind('site', SITE_CODES_KEY, 299, windowEnds)
      .run()
    expect((await sendCode(local(), 'fan1@example.com')).status).toBe(200)
    expect(siteLimitLines()).toEqual([])
    const held = await sendCode(local(), 'fan2@example.com', { ip: '203.0.113.9' })
    expect(await answer(held)).toEqual({ status: 200, body: { success: true } })
    expect(await mailCount('fan1@example.com')).toBe(1)
    expect(await mailCount('fan2@example.com')).toBe(0)
    // One line: the limit and the seconds left in its window, with no email, client or key.
    const lines = siteLimitLines()
    expect(lines).toHaveLength(1)
    const fields = JSON.parse(lines[0].slice('auth_site_code_limit '.length))
    expect(fields).toEqual({ max: 300, windowSeconds: 3600, retryAfterSeconds: expect.any(Number) })
    expect(fields.retryAfterSeconds).toBeGreaterThan(29 * 60)
    expect(fields.retryAfterSeconds).toBeLessThanOrEqual(30 * 60)
    expect(lines[0]).not.toMatch(/fan|example|203\.0\.113|[0-9a-f]{64}/i)
  })

  it('find each row a spend reads or deletes through an index, never by reading the table', async () => {
    // The statements consumeSlot runs, as it runs them.
    const prepared: string[] = []
    const recording = {
      prepare(sql: string) {
        prepared.push(sql)
        return bindings.DB.prepare(sql)
      },
      batch: (statements: D1PreparedStatement[]) => bindings.DB.batch(statements)
    } as unknown as D1Database
    expect((await consumeSlot(recording, 'x', Date.now(), { window: 60, max: 1 })).allowed).toBe(
      true
    )
    const plans = await Promise.all(
      prepared.map(async sql => {
        const parameters = Math.max(0, ...[...sql.matchAll(/\?(\d+)/g)].map(([, n]) => Number(n)))
        const plan = await rows<{ detail: string }>(
          `EXPLAIN QUERY PLAN ${sql}`,
          ...Array(parameters).fill(0)
        )
        return plan.map(step => step.detail)
      })
    )
    expect(prepared[0]).toMatch(/^DELETE FROM rate_limit WHERE last_request <= \?1$/)
    expect(plans[0]).toEqual([expect.stringMatching(/ USING .*INDEX rate_limit_last_request_idx /)])
    expect(plans.flat().filter(step => /\bSCAN rate_limit\b/.test(step))).toEqual([])
  })

  it('keep no email or IP address in their keys', async () => {
    await signIn('Fan@Example.com', { ip: '203.0.113.77' })
    await signIn('fan@example.com', { ip: '2001:db8:77::1' })
    const keys = (await rows<{ key: string }>('SELECT key FROM rate_limit')).map(row => row.key)
    expect(keys.length).toBeGreaterThanOrEqual(8)
    for (const key of keys) {
      expect(key).toMatch(
        /^(client|email|email-client|sign-in-client)\|[0-9a-f]{64}$|^site\|send-code$/
      )
    }
    expect(keys.join(' ')).not.toMatch(/203|2001|db8|fan|example/i)
  })

  it('count each window from its first request, and refuse with the time left', async () => {
    const rule = { window: 60, max: 2 }
    const start = 1_000_000
    const slot = async (at: number) => (await consumeSlot(bindings.DB, 'x', at, rule)).allowed
    expect([await slot(start), await slot(start + 1)]).toEqual([true, true])
    expect(await consumeSlot(bindings.DB, 'x', start + 2, rule)).toEqual({
      allowed: false,
      retryAfter: 60
    })
    expect(await slot(start + 59_999)).toBe(false)
    expect([await slot(start + 60_000), await slot(start + 60_001)]).toEqual([true, true])
    expect(await slot(start + 60_002)).toBe(false)
  })

  it('delete every row whose window has ended, on any request', async () => {
    const insert = 'INSERT INTO rate_limit (id, key, count, last_request) VALUES (?, ?, 1, ?)'
    await bindings.DB.batch([
      bindings.DB.prepare(insert).bind('a', 'ended', Date.now() - 1),
      bindings.DB.prepare(insert).bind('b', 'live', Date.now() + 60_000)
    ])
    expect((await sendCode(local(), 'fan@example.com')).status).toBe(200)
    const keys = (await rows<{ key: string }>('SELECT key FROM rate_limit')).map(row => row.key)
    expect(keys).toContain('live')
    expect(keys).not.toContain('ended')
  })

  it('never hold reading the session', async () => {
    for (let n = 0; n < 120; n++) {
      expect((await serveAuthRequest(get(GET_SESSION_ENDPOINT), local())).status).toBe(200)
    }
    expect(await rows('SELECT key FROM rate_limit')).toEqual([])
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
    // Refused here, before Better Auth (whose own 415 comes after its limiter counts it).
    expect(await rows('SELECT key FROM rate_limit')).toEqual([])

    const sameOrigin = post(SEND_CODE_ENDPOINT, body, {
      headers: { 'sec-fetch-site': 'same-origin' }
    })
    expect((await serveAuthRequest(sameOrigin, local())).status).toBe(200)
  })

  it('are refused on Staging unless they come from its own origin', async () => {
    const sent: Sent = []
    const workersDev = 'https://pedos-web-staging.serpcompany.workers.dev'
    const own = post(SEND_CODE_ENDPOINT, body, { base: workersDev, origin: STAGING })
    expect((await serveAuthRequest(own, staging(sent))).status).toBe(200)
    const other = post(SEND_CODE_ENDPOINT, body, { base: workersDev, origin: workersDev })
    expect(await refused(other, staging(sent))).toEqual({ status: 403, code: 'INVALID_ORIGIN' })
  })

  it('are also refused by Better Auth’s own checks, forced on under NODE_ENV=test', async () => {
    expect(process.env.NODE_ENV).toBe('test')
    const cookie = await signIn('fan@example.com')
    const resolved = resolveAuthSettings(local())
    if (!resolved.ok) throw new Error(resolved.reason)
    const auth = createAuth({
      db: createDatabase(bindings.DB),
      settings: resolved.settings,
      email: createEmailSender({ kind: 'off', reason: 'email_not_configured' })
    })
    // Straight to Better Auth, past this file's guard.
    const request = post(SIGN_OUT_ENDPOINT, {}, { origin: 'https://evil.example', cookie })
    const response = await auth.handler(request)
    expect(response.status).toBe(403)
    expect(await readSessionUser(new Request(LOCAL, { headers: { cookie } }), local())).not.toBe(
      null
    )
  })
})

describe('Turnstile', () => {
  it('refuses a code request without a token, having spent only the client’s limit', async () => {
    const response = await sendCode(local(), 'fan@example.com', { captcha: null })
    expect(await answer(response)).toMatchObject({
      status: 400,
      body: { code: 'MISSING_RESPONSE' }
    })
    expect(await mailCount('fan@example.com')).toBe(0)
    expect(siteverifyCalls()).toEqual([])
    const key = await clientLimitKey(SECRET, `203.0.113.1|${SEND_CODE_ENDPOINT}`)
    expect(await rows('SELECT key, count FROM rate_limit')).toEqual([{ key, count: 1 }])
  })

  it('refuses a code request with a token Turnstile rejects', async () => {
    const response = await sendCode(local(), 'fan@example.com', { captcha: 'forged' })
    expect(await answer(response)).toMatchObject({
      status: 403,
      body: { code: 'VERIFICATION_FAILED' }
    })
    expect(await mailCount('fan@example.com')).toBe(0)
  })

  it('sends a code once Turnstile accepts the token, asking with the secret and the client', async () => {
    const response = await sendCode(local(), 'fan@example.com', { ip: '203.0.113.7' })
    expect(await answer(response)).toEqual({ status: 200, body: { success: true } })
    expect(await mailCount('fan@example.com')).toBe(1)
    expect(siteverifyCalls()).toEqual([
      { secret: TURNSTILE_TEST_SECRET_KEY, response: TEST_TOKEN, remoteip: '203.0.113.7' }
    ])
  })

  it('refuses a code request when siteverify can’t be reached', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new TypeError('fetch failed'))
    const response = await sendCode(local(), 'fan@example.com')
    expect(response.status).toBe(500)
    expect(await mailCount('fan@example.com')).toBe(0)
  })

  it('checks only code requests', async () => {
    expect((await sendCode(local(), 'fan@example.com')).status).toBe(200)
    const code = await mailedCode('fan@example.com')
    const signedIn = await trySignIn(local(), 'fan@example.com', code, { captcha: null })
    expect(signedIn.status).toBe(200)
    expect(siteverifyCalls()).toHaveLength(1)
  })

  it('sends no code where its keys aren’t set, and still reads sessions', async () => {
    for (const unset of ['TURNSTILE_SECRET_KEY', 'TURNSTILE_SITE_KEY'] as const) {
      const sent: Sent = []
      const env = staging(sent, { [unset]: undefined })
      const response = await sendCode(env, 'member@example.com', { base: STAGING })
      expect(await answer(response)).toMatchObject({
        status: 503,
        body: { code: 'TURNSTILE_UNAVAILABLE' }
      })
      expect(sent).toEqual([])
      const key = await serveAuthRequest(get(TURNSTILE_ENDPOINT, { base: STAGING }), env)
      expect(await answer(key)).toMatchObject({
        status: 503,
        body: { code: 'TURNSTILE_UNAVAILABLE' }
      })
      const session = await serveAuthRequest(get(GET_SESSION_ENDPOINT, { base: STAGING }), env)
      expect(session.status).toBe(200)
    }
  })

  it('answers its site key, never cached: the var, or locally Cloudflare’s test key', async () => {
    const answers = [
      await serveAuthRequest(get(TURNSTILE_ENDPOINT, { base: STAGING }), staging([])),
      await serveAuthRequest(get(`${TURNSTILE_ENDPOINT}/`), local()),
      await serveAuthRequest(get(TURNSTILE_ENDPOINT), local({ TURNSTILE_SITE_KEY: 'own-key' }))
    ]
    expect(answers.map(response => response.headers.get('cache-control'))).toEqual([
      'private, no-store',
      'private, no-store',
      'private, no-store'
    ])
    expect(await Promise.all(answers.map(answer))).toEqual([
      { status: 200, body: { siteKey: 'staging-site-key' } },
      { status: 200, body: { siteKey: TURNSTILE_TEST_SITE_KEY } },
      { status: 200, body: { siteKey: 'own-key' } }
    ])
    const misconfigured = local({ SITE_ENV: 'preview' })
    const refused = await serveAuthRequest(get(TURNSTILE_ENDPOINT), misconfigured)
    expect(await answer(refused)).toMatchObject({ status: 503, body: { code: 'AUTH_UNAVAILABLE' } })
    const posted = await serveAuthRequest(post(TURNSTILE_ENDPOINT, {}), local())
    expect(posted.status).toBe(404)
  })
})

describe('Staging', () => {
  it('sends codes from the support address, to its allowlist only', async () => {
    const sent: Sent = []
    expect((await sendCode(staging(sent), 'member@example.com', { base: STAGING })).status).toBe(
      200
    )
    expect((await sendCode(staging(sent), 'other@example.com', { base: STAGING })).status).toBe(200)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      from: { name: 'Farty', email: 'support@farty.fm' },
      to: 'member@example.com',
      subject: expect.stringMatching(/^\d{6} is your Farty sign-in code$/)
    })
  })

  it('creates no account off the allowlist, should it change after the code was sent', async () => {
    const sent: Sent = []
    await sendCode(staging(sent), 'member@example.com', { base: STAGING })
    const code = String(sent[0].subject).slice(0, 6)
    const changed = staging(sent, { STAGING_SIGNUP_ALLOWLIST: 'someone@example.com' })
    const response = await trySignIn(changed, 'member@example.com', code, { base: STAGING })
    expect(await answer(response)).toMatchObject({ status: 400, body: { code: 'INVALID_OTP' } })
    expect(await rows('SELECT id FROM user')).toEqual([])
  })

  it('signs in with a secure cookie, and answers the smoke test', async () => {
    const sent: Sent = []
    await sendCode(staging(sent), 'member@example.com', { base: STAGING })
    const code = String(sent[0].subject).slice(0, 6)
    const response = await trySignIn(staging(sent), 'member@example.com', code, { base: STAGING })
    expect(response.status).toBe(200)
    const cookie = sessionCookie(response)
    expect(cookie).toMatch(/^__Secure-pedos\.session_token=/)
    expect(response.headers.getSetCookie()[0]).toMatch(/; Secure/i)
    const workersDev = 'https://pedos-web-staging.serpcompany.workers.dev'
    const smoke = await serveAuthRequest(
      get(GET_SESSION_ENDPOINT, { base: workersDev }),
      staging(sent)
    )
    expect(await answer(smoke)).toEqual({ status: 200, body: null })
    // scripts/smoke.sh's malformed sign-in, as CI sends it to workers.dev from the site's origin.
    const malformed = post(
      SIGN_IN_ENDPOINT,
      { email: 'not-an-email', otp: '000000' },
      { base: workersDev, origin: STAGING }
    )
    const refused = await serveAuthRequest(malformed, staging(sent))
    expect(refused.status).toBe(400)
    expect(refused.headers.get('content-type')).toMatch(/^application\/json/)
  })
})

describe('Production', () => {
  it('answers the smoke test on workers.dev', async () => {
    const env: AuthEnv = {
      SITE_ENV: 'production',
      DB: bindings.DB,
      EMAIL: { send: async () => ({ messageId: 'test' }) },
      EMAIL_FROM: 'Farty <support@farty.fm>',
      BETTER_AUTH_URL: 'https://farty.fm',
      BETTER_AUTH_SECRET: SECRET
    }
    // scripts/smoke.sh's two sign-in checks, as CI sends them to Production's workers.dev host.
    const workersDev = 'https://pedos-web-production.serpcompany.workers.dev'
    const session = await serveAuthRequest(get(GET_SESSION_ENDPOINT, { base: workersDev }), env)
    expect(session.headers.get('content-type')).toMatch(/^application\/json/)
    expect(await answer(session)).toEqual({ status: 200, body: null })
    const malformed = post(
      SIGN_IN_ENDPOINT,
      { email: 'not-an-email', otp: '000000' },
      { base: workersDev, origin: 'https://farty.fm' }
    )
    const refused = await serveAuthRequest(malformed, env)
    expect(refused.status).toBe(400)
    expect(refused.headers.get('content-type')).toMatch(/^application\/json/)
  })
})

describe('settings', () => {
  const deployed = {
    DB: {} as D1Database,
    SITE_ENV: 'production',
    BETTER_AUTH_URL: 'https://farty.fm',
    BETTER_AUTH_SECRET: SECRET
  }

  it('need the secret, the environment’s own URL and Staging’s allowlist', () => {
    expect(resolveAuthSettings(deployed)).toMatchObject({
      ok: true,
      settings: { baseURL: 'https://farty.fm', useSecureCookies: true, signupAllowlist: null }
    })
    const reasons = [
      { ...deployed, SITE_ENV: 'preview' },
      { ...deployed, BETTER_AUTH_SECRET: undefined },
      { ...deployed, BETTER_AUTH_SECRET: 'too-short' },
      { ...deployed, BETTER_AUTH_URL: undefined },
      { ...deployed, BETTER_AUTH_URL: 'https://staging.farty.fm' },
      { ...deployed, SITE_ENV: 'staging', BETTER_AUTH_URL: STAGING },
      { ...deployed, SITE_ENV: 'staging', BETTER_AUTH_URL: STAGING, STAGING_SIGNUP_ALLOWLIST: 'x' }
    ].map(env => {
      const result = resolveAuthSettings(env)
      return result.ok ? 'ok' : result.reason
    })
    expect(reasons).toEqual([
      'deployment_not_configured',
      'auth_secret_missing',
      'auth_secret_missing',
      'auth_url_invalid',
      'auth_url_invalid',
      'signup_allowlist_invalid',
      'signup_allowlist_invalid'
    ])
  })

  it('answer 503 when sign-in isn’t set up, and read no session', async () => {
    const env = { ...staging([]), BETTER_AUTH_SECRET: undefined }
    const response = await serveAuthRequest(get(GET_SESSION_ENDPOINT, { base: STAGING }), env)
    expect(await answer(response)).toMatchObject({
      status: 503,
      body: { code: 'AUTH_UNAVAILABLE' }
    })
    await expect(readSessionUser(new Request(STAGING), env)).rejects.toBeInstanceOf(
      AuthUnavailableError
    )
  })

  it('take Turnstile’s keys from the environment, or locally Cloudflare’s test keys', () => {
    const turnstile = (env: AuthEnv) => {
      const result = resolveAuthSettings(env)
      return result.ok ? result.settings.turnstile : result.reason
    }
    const keys = { TURNSTILE_SITE_KEY: 'site', TURNSTILE_SECRET_KEY: 'secret' }
    expect(turnstile({ ...deployed, ...keys })).toEqual({ siteKey: 'site', secretKey: 'secret' })
    expect(turnstile(deployed)).toBeNull()
    expect(turnstile({ ...deployed, ...keys, TURNSTILE_SECRET_KEY: ' ' })).toBeNull()
    expect(turnstile({ ...deployed, ...keys, TURNSTILE_SITE_KEY: undefined })).toBeNull()
    expect(turnstile(local())).toEqual({
      siteKey: TURNSTILE_TEST_SITE_KEY,
      secretKey: TURNSTILE_TEST_SECRET_KEY
    })
    expect(turnstile(local(keys))).toEqual({ siteKey: 'site', secretKey: 'secret' })
  })

  it('run locally without a secret, on any loopback host', async () => {
    const env = local({ BETTER_AUTH_SECRET: undefined })
    for (const base of ['http://localhost:4115', 'http://127.0.0.1:3000', 'http://[::1]:8787']) {
      const response = await serveAuthRequest(get(GET_SESSION_ENDPOINT, { base }), env)
      expect(response.status).toBe(200)
    }
  })
})
