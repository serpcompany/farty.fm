import { afterAll, beforeAll, beforeEach, expect, vi } from 'vitest'

import { createDatabase } from '@/db/database'
import { GET_SESSION_ENDPOINT, SEND_CODE_ENDPOINT, SIGN_IN_ENDPOINT } from '@/server/auth-endpoints'
import { serveAuthRequest } from '@/server/auth-request'
import { type AuthEnv, resolveAuthSettings } from '@/server/auth-settings'
import { createAuth } from '@/server/create-auth'
import { listCapturedEmails } from '@/server/dev-mailbox'
import { createEmailSender } from '@/server/email'

import { type LocalBindings, localBindings } from './local-bindings'

export const LOCAL = 'http://localhost:3115'
export const STAGING = 'https://staging.farty.fm'
export const SECRET = 'a-test-secret-that-is-long-enough-0123456789'
export const STAGING_WORKERS_DEV = 'https://pedos-web-staging.serpcompany.workers.dev'

export type Sent = EmailMessageBuilder[]

export type RequestOptions = {
  base?: string
  origin?: string | null
  ip?: string
  cookie?: string
  headers?: Record<string, string>
}

export function post(path: string, body: unknown, options: RequestOptions = {}): Request {
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

export function get(
  path: string,
  { base = LOCAL, cookie, ip = '203.0.113.1' }: RequestOptions = {}
) {
  const headers = new Headers({ 'cf-connecting-ip': ip })
  if (cookie) headers.set('cookie', cookie)
  return new Request(`${base}/api/auth${path}`, { headers })
}

export const sendCode = (env: AuthEnv, email: string, options?: RequestOptions) =>
  serveAuthRequest(post(SEND_CODE_ENDPOINT, { email, type: 'sign-in' }, options), env)

export const trySignIn = (env: AuthEnv, email: string, otp: string, options?: RequestOptions) =>
  serveAuthRequest(post(SIGN_IN_ENDPOINT, { email, otp }, options), env)

export function sessionCookie(response: Response): string {
  return response.headers
    .getSetCookie()
    .map(cookie => cookie.split(';')[0])
    .filter(cookie => cookie.includes('session_token'))
    .join('; ')
}

export async function answer(response: Response) {
  return { status: response.status, body: await response.json() }
}

export const siteLimitLines = () =>
  vi
    .mocked(console.warn)
    .mock.calls.map(([line]) => String(line))
    .filter(line => line.startsWith('auth_site_code_limit '))

export async function expectSmokeTestAnswers(env: AuthEnv, workersDev: string, origin: string) {
  const session = await serveAuthRequest(get(GET_SESSION_ENDPOINT, { base: workersDev }), env)
  expect(session.headers.get('content-type')).toMatch(/^application\/json/)
  expect(await answer(session)).toEqual({ status: 200, body: null })
  const malformed = post(
    SIGN_IN_ENDPOINT,
    { email: 'not-an-email', otp: '000000' },
    { base: workersDev, origin }
  )
  const refused = await serveAuthRequest(malformed, env)
  expect(refused.status).toBe(400)
  expect(refused.headers.get('content-type')).toMatch(/^application\/json/)
}

const PLATFORM_PROXY_START_MS = 60_000

export function signInHarness() {
  let bindings: LocalBindings | undefined
  const started = () => {
    if (!bindings) throw new Error('The local bindings haven’t started')
    return bindings
  }
  beforeAll(async () => {
    bindings = await localBindings()
  }, PLATFORM_PROXY_START_MS)
  afterAll(() => bindings?.dispose())
  beforeEach(async () => {
    await started().reset()
    for (const level of ['info', 'warn', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation(() => {})
    }
    return () => vi.restoreAllMocks()
  })

  const local = (extra: Partial<AuthEnv> = {}): AuthEnv => ({
    DB: started().DB,
    DEV_MAILBOX: started().DEV_MAILBOX,
    BETTER_AUTH_SECRET: SECRET,
    ...extra
  })

  const staging = (sent: Sent, extra: Partial<AuthEnv> = {}): AuthEnv => ({
    SITE_ENV: 'staging',
    DB: started().DB,
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
    ...extra
  })

  const mailed = async () => listCapturedEmails(started().DEV_MAILBOX)

  async function mailedCode(to: string): Promise<string> {
    const email = (await mailed()).find(mail => mail.to === to)
    const code = email?.text.split('\n').find(line => /^\d+$/.test(line))
    if (!code) throw new Error(`No code was mailed to ${to}`)
    return code
  }

  const mailCount = async (to: string) => (await mailed()).filter(mail => mail.to === to).length

  async function signIn(email: string, options?: RequestOptions): Promise<string> {
    expect((await sendCode(local(), email, options)).status).toBe(200)
    const response = await trySignIn(local(), email, await mailedCode(email.toLowerCase()), options)
    expect(response.status).toBe(200)
    return sessionCookie(response)
  }

  const rows = async <T>(sql: string, ...values: unknown[]) =>
    (
      await started()
        .DB.prepare(sql)
        .bind(...values)
        .all<T>()
    ).results

  function offlineAuth() {
    const resolved = resolveAuthSettings(local())
    if (!resolved.ok) throw new Error(resolved.reason)
    return createAuth({
      db: createDatabase(started().DB),
      settings: resolved.settings,
      email: createEmailSender({ kind: 'off', reason: 'email_not_configured' })
    })
  }

  return {
    db: () => started().DB,
    local,
    staging,
    mailed,
    mailedCode,
    mailCount,
    signIn,
    rows,
    offlineAuth
  }
}
