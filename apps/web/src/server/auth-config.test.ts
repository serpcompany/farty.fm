import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDatabase } from '@/db/database'
import { type LocalBindings, localBindings } from '@/test-support/local-bindings'

import {
  AUTH_ENDPOINTS,
  AUTH_MAX_BYTES,
  type AuthEnv,
  authRoutes,
  CODES_PER_EMAIL,
  consumeEmailSlot,
  createAuth,
  emailLimitKey,
  GET_SESSION_ENDPOINT,
  hashSignInCode,
  RATE_LIMITS,
  readSessionUser,
  resolveAuthSettings,
  SEND_CODE_ENDPOINT,
  SIGN_IN_ENDPOINT,
  SIGN_OUT_ENDPOINT,
  serveAuthRequest
} from './auth-config'
import { listCapturedEmails } from './dev-mailbox'
import { createEmailSender } from './email'

// Sign-in on a real local D1 and dev mailbox (src/test-support/local-bindings.ts), through the
// same `serveAuthRequest` the route serves. Each test starts from empty tables.

const LOCAL = 'http://localhost:3115'
const STAGING = 'https://staging.pedos.app'
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
  EMAIL_FROM: 'Pedos <support@pedos.app>',
  BETTER_AUTH_URL: STAGING,
  BETTER_AUTH_SECRET: SECRET,
  STAGING_SIGNUP_ALLOWLIST: 'member@example.com',
  ...extra
})

type RequestOptions = {
  base?: string
  origin?: string | null
  ip?: string
  cookie?: string
  headers?: Record<string, string>
}

function post(path: string, body: unknown, options: RequestOptions = {}): Request {
  const { base = LOCAL, origin = base, ip = '203.0.113.1', cookie, headers = {} } = options
  const all = new Headers({
    'content-type': 'application/json',
    'cf-connecting-ip': ip,
    ...headers
  })
  if (origin !== null) all.set('origin', origin)
  if (cookie) all.set('cookie', cookie)
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

  it('keeps no IP address or user agent with a session', async () => {
    await signIn('fan@example.com', { headers: { 'user-agent': 'Mozilla/5.0 Test' } })
    expect(await rows('SELECT ip_address, user_agent FROM session')).toEqual([
      { ip_address: null, user_agent: null }
    ])
  })

  it('refuses any field but email and otp, and any code type but sign-in', async () => {
    const extra = await serveAuthRequest(
      post(SIGN_IN_ENDPOINT, { email: 'fan@example.com', otp: '123456', name: 'Fan' }),
      local()
    )
    expect(await answer(extra)).toMatchObject({ status: 400, body: { code: 'FIELD_NOT_ALLOWED' } })
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
    const padded = { email: 'fan@example.com', type: 'sign-in', pad: 'x'.repeat(AUTH_MAX_BYTES) }
    const response = await serveAuthRequest(post(SEND_CODE_ENDPOINT, padded), local())
    expect(await answer(response)).toMatchObject({
      status: 413,
      body: { code: 'PAYLOAD_TOO_LARGE' }
    })
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
      expect(email.subject).toBe(`${code} is your Pedos sign-in code`)
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

  it('allow three guesses', async () => {
    await sendCode(local(), 'fan@example.com')
    const code = await mailedCode('fan@example.com')
    const wrong = code === '000000' ? '111111' : '000000'
    for (const _ of [1, 2, 3]) {
      const guess = await trySignIn(local(), 'fan@example.com', wrong)
      expect(await answer(guess)).toMatchObject({ status: 400, body: { code: 'INVALID_OTP' } })
    }
    const right = await trySignIn(local(), 'fan@example.com', code)
    expect(right.status).toBe(403)
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

  it('a code request past the per-email limit, or off Staging’s allowlist', async () => {
    const sent: Sent = []
    const env = staging(sent)
    const ip = (n: number) => ({ base: STAGING, ip: `198.51.100.${n}` })
    const allowed = await sendCode(env, 'member@example.com', ip(1))
    const other = await sendCode(env, 'other@example.com', ip(2))
    expect(await answer(other)).toEqual(await answer(allowed))
    expect(allowed.status).toBe(200)
    for (let n = 2; n <= CODES_PER_EMAIL; n++) await sendCode(env, 'member@example.com', ip(n))
    const held = await sendCode(env, 'member@example.com', ip(9))
    expect(await answer(held)).toEqual({ status: 200, body: { success: true } })
    expect(sent.map(message => message.to)).toEqual(
      Array(CODES_PER_EMAIL).fill('member@example.com')
    )
  })
})

describe('rate limits, in D1', () => {
  it('hold code requests per IP', async () => {
    const { max } = RATE_LIMITS[SEND_CODE_ENDPOINT]
    for (let n = 1; n <= max; n++) {
      expect((await sendCode(local(), `fan${n}@example.com`)).status).toBe(200)
    }
    const held = await sendCode(local(), 'one-more@example.com')
    expect(held.status).toBe(429)
    expect(await mailCount('one-more@example.com')).toBe(0)
    const elsewhere = await sendCode(local(), 'one-more@example.com', { ip: '203.0.113.9' })
    expect(elsewhere.status).toBe(200)
    expect(
      await rows('SELECT key, count FROM rate_limit WHERE key LIKE ?', '203.0.113.1|%')
    ).toEqual([{ key: `203.0.113.1|${SEND_CODE_ENDPOINT}`, count: max }])
  })

  it('hold sign-in guesses per IP', async () => {
    const { max } = RATE_LIMITS[SIGN_IN_ENDPOINT]
    for (let n = 1; n <= max; n++) {
      expect((await trySignIn(local(), `fan${n}@example.com`, '123456')).status).toBe(400)
    }
    expect((await trySignIn(local(), 'fan@example.com', '123456')).status).toBe(429)
  })

  it('send an email at most CODES_PER_EMAIL codes an hour, from any IP', async () => {
    for (let n = 1; n <= CODES_PER_EMAIL + 2; n++) {
      const response = await sendCode(local(), 'fan@example.com', { ip: `198.51.100.${n}` })
      expect(await answer(response)).toEqual({ status: 200, body: { success: true } })
    }
    expect(await mailCount('fan@example.com')).toBe(CODES_PER_EMAIL)
    const [row] = await rows<{ key: string }>("SELECT key FROM rate_limit WHERE key LIKE 'email|%'")
    expect(row.key).not.toContain('fan')
  })

  it('give an email new slots once its hour is up', async () => {
    const rule = { window: 60, max: 2 }
    const start = 1_000_000
    const slot = (at: number) => consumeEmailSlot(bindings.DB, 'email|x', at, rule)
    expect([await slot(start), await slot(start + 1), await slot(start + 2)]).toEqual([
      true,
      true,
      false
    ])
    expect(await slot(start + 59_999)).toBe(false)
    expect([await slot(start + 60_000), await slot(start + 60_001)]).toEqual([true, true])
    expect(await slot(start + 60_002)).toBe(false)
  })

  it('keep an email’s hour through Better Auth’s pruning of its own old rows', async () => {
    const minutes = (n: number) => n * 60_000
    const key = await emailLimitKey(SECRET, 'Fan@Example.com')
    for (let n = 0; n < CODES_PER_EMAIL; n++) {
      await consumeEmailSlot(bindings.DB, key, Date.now() - minutes(20))
    }
    // An IP whose window ran out, so its next request prunes, and a row old enough to go.
    const insert = 'INSERT INTO rate_limit (id, key, count, last_request) VALUES (?, ?, 1, ?)'
    await bindings.DB.batch([
      bindings.DB.prepare(insert).bind(
        'a',
        `203.0.113.1|${SEND_CODE_ENDPOINT}`,
        Date.now() - minutes(11)
      ),
      bindings.DB.prepare(insert).bind('b', 'stale', Date.now() - minutes(120))
    ])
    expect((await sendCode(local(), 'other@example.com')).status).toBe(200)
    expect(await rows("SELECT key FROM rate_limit WHERE key = 'stale'")).toEqual([])
    expect((await sendCode(local(), 'fan@example.com')).status).toBe(200)
    expect(await mailCount('fan@example.com')).toBe(0)
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

describe('Staging', () => {
  it('sends codes from the support address, to its allowlist only', async () => {
    const sent: Sent = []
    expect((await sendCode(staging(sent), 'member@example.com', { base: STAGING })).status).toBe(
      200
    )
    expect((await sendCode(staging(sent), 'other@example.com', { base: STAGING })).status).toBe(200)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      from: { name: 'Pedos', email: 'support@pedos.app' },
      to: 'member@example.com',
      subject: expect.stringMatching(/^\d{6} is your Pedos sign-in code$/)
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

describe('settings', () => {
  const deployed = {
    DB: {} as D1Database,
    SITE_ENV: 'production',
    BETTER_AUTH_URL: 'https://pedos.app',
    BETTER_AUTH_SECRET: SECRET
  }

  it('need the secret, the environment’s own URL and Staging’s allowlist', () => {
    expect(resolveAuthSettings(deployed)).toMatchObject({
      ok: true,
      settings: { baseURL: 'https://pedos.app', useSecureCookies: true, signupAllowlist: null }
    })
    const reasons = [
      { ...deployed, SITE_ENV: 'preview' },
      { ...deployed, BETTER_AUTH_SECRET: undefined },
      { ...deployed, BETTER_AUTH_SECRET: 'too-short' },
      { ...deployed, BETTER_AUTH_URL: undefined },
      { ...deployed, BETTER_AUTH_URL: 'https://staging.pedos.app' },
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
    expect(await readSessionUser(new Request(STAGING), env)).toBe('unavailable')
  })

  it('run locally without a secret, on any loopback host', async () => {
    const env = local({ BETTER_AUTH_SECRET: undefined })
    for (const base of ['http://localhost:4115', 'http://127.0.0.1:3000', 'http://[::1]:8787']) {
      const response = await serveAuthRequest(get(GET_SESSION_ENDPOINT, { base }), env)
      expect(response.status).toBe(200)
    }
  })
})
