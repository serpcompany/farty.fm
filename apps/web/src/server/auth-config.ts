import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { betterAuth } from 'better-auth/minimal'
import { emailOTP } from 'better-auth/plugins/email-otp'
import { z } from 'zod'

import { createDatabase, type Database } from '@/db/database'
import { account, rateLimit, session, user, verification } from '@/db/schema'

import {
  createEmailSender,
  type EmailEnv,
  type EmailSender,
  emailConfig,
  SIGN_IN_CODE_MINUTES
} from './email'
import { deployment, isLocalHost } from './environment'

/**
 * Sign-in for Pedos (#152; SERP's better-auth standard, with serp.app's `src/server/auth/` as the
 * reference): a 6-digit code by email, and the first sign-in creates the account. No passwords.
 * No Next.js imports, so the tests run this file on a real local D1 (`auth-config.test.ts`).
 *
 * - **Four endpoints** (`AUTH_ENDPOINTS`): send a code, sign in with it, read the session, sign
 *   out. Every other Better Auth route answers 404 before Better Auth sees the request.
 * - **Writes** must come from the site itself (`crossSiteRefusal`), as JSON. Better Auth's own
 *   origin and CSRF checks also run, forced on (Better Auth skips them under `NODE_ENV=test`).
 * - **Codes** are 6 digits, live 10 minutes, allow 3 guesses, and are stored only as an HMAC
 *   keyed by `BETTER_AUTH_SECRET`, so a copy of the database can't be brute-forced into codes.
 * - **Limits** live in D1's `rate_limit` table: Better Auth's per-IP limits (`RATE_LIMITS`), and
 *   `CODES_PER_EMAIL` per email per hour (`consumeEmailSlot`).
 * - **No answer says whether an email has an account.** A code request for any email answers
 *   `{ success: true }`, sent or not (the per-email limit, Staging's sign-up allowlist), and every
 *   wrong guess answers `INVALID_OTP`.
 * - **Sessions** are read from D1 on every request (no cookie cache), and keep no IP address or
 *   user agent.
 */

export const AUTH_BASE_PATH = '/api/auth'
export const SEND_CODE_ENDPOINT = '/email-otp/send-verification-otp'
export const SIGN_IN_ENDPOINT = '/sign-in/email-otp'
export const GET_SESSION_ENDPOINT = '/get-session'
export const SIGN_OUT_ENDPOINT = '/sign-out'

export type AuthEndpoint = { method: 'GET' | 'POST'; path: string }

/** The only Better Auth endpoints served. */
export const AUTH_ENDPOINTS: readonly AuthEndpoint[] = [
  { method: 'POST', path: SEND_CODE_ENDPOINT },
  { method: 'POST', path: SIGN_IN_ENDPOINT },
  { method: 'GET', path: GET_SESSION_ENDPOINT },
  { method: 'POST', path: SIGN_OUT_ENDPOINT }
]

/** Per IP, by Better Auth's limiter. `false` turns it off for a path. */
export const RATE_LIMITS = {
  [SEND_CODE_ENDPOINT]: { window: 10 * 60, max: 10 },
  [SIGN_IN_ENDPOINT]: { window: 60, max: 10 },
  // Every page load asks, so no D1 write each time.
  [GET_SESSION_ENDPOINT]: false
} as const

/** Codes sent to one email per `EMAIL_WINDOW_SECONDS`, whoever asks. */
export const CODES_PER_EMAIL = 5
export const EMAIL_WINDOW_SECONDS = 60 * 60

/** Far above any sign-in body, far below anything that costs memory. */
export const AUTH_MAX_BYTES = 16 * 1024

const COOKIE_PREFIX = 'pedos'
const SIGN_IN_CODE_ATTEMPTS = 3
const MIN_SECRET_LENGTH = 32

export type AuthEnv = EmailEnv & {
  DB: D1Database
  BETTER_AUTH_URL?: unknown
  BETTER_AUTH_SECRET?: unknown
  STAGING_SIGNUP_ALLOWLIST?: unknown
}

export type AuthSettings = {
  baseURL: string | { allowedHosts: string[]; protocol: 'http' }
  trustedOrigins: string[]
  secret: string
  useSecureCookies: boolean
  /** The origin every write must come from; null locally, where it's the request's own. */
  origin: string | null
  /** Staging's sign-up allowlist; null where anyone may sign up. */
  signupAllowlist: ReadonlySet<string> | null
}

export type AuthUnavailableReason =
  | 'deployment_not_configured'
  | 'auth_secret_missing'
  | 'auth_url_invalid'
  | 'signup_allowlist_invalid'

export type AuthSettingsResult =
  | { ok: true; settings: AuthSettings }
  | { ok: false; reason: AuthUnavailableReason }

const LOCAL_HOST_PATTERNS = ['localhost', '127.0.0.1', '[::1]'].flatMap(host => [host, `${host}:*`])

const EMAIL = z.email()

/**
 * This environment's sign-in settings, or why there are none (answered 503, fail closed).
 * Deployed: `BETTER_AUTH_SECRET` (a Worker secret) and `BETTER_AUTH_URL` naming the environment's
 * own origin, and on Staging a sign-up allowlist. Locally: any loopback host over http, and a
 * throwaway secret unless `.dev.vars` sets one.
 */
export function resolveAuthSettings(env: AuthEnv): AuthSettingsResult {
  const target = deployment(env)
  if (target.kind === 'misconfigured') return { ok: false, reason: 'deployment_not_configured' }
  const secret =
    typeof env.BETTER_AUTH_SECRET === 'string' && env.BETTER_AUTH_SECRET.length >= MIN_SECRET_LENGTH
      ? env.BETTER_AUTH_SECRET
      : null
  if (target.kind === 'local') {
    const settings: AuthSettings = {
      baseURL: { allowedHosts: LOCAL_HOST_PATTERNS, protocol: 'http' },
      trustedOrigins: LOCAL_HOST_PATTERNS.map(host => `http://${host}`),
      secret: secret ?? ephemeralSecret(),
      useSecureCookies: false,
      origin: null,
      signupAllowlist: null
    }
    return { ok: true, settings }
  }
  if (secret === null) return { ok: false, reason: 'auth_secret_missing' }
  if (env.BETTER_AUTH_URL !== target.origin) return { ok: false, reason: 'auth_url_invalid' }
  let signupAllowlist: ReadonlySet<string> | null = null
  if (target.name === 'staging') {
    signupAllowlist = parseAllowlist(env.STAGING_SIGNUP_ALLOWLIST)
    if (signupAllowlist === null) return { ok: false, reason: 'signup_allowlist_invalid' }
  }
  const settings: AuthSettings = {
    baseURL: target.origin,
    trustedOrigins: [target.origin],
    secret,
    useSecureCookies: true,
    origin: target.origin,
    signupAllowlist
  }
  return { ok: true, settings }
}

/** Comma-separated emails, lowercased; null when it's empty or any entry isn't an email. */
export function parseAllowlist(value: unknown): ReadonlySet<string> | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const emails = value.split(',').map(email => email.trim().toLowerCase())
  return emails.every(email => EMAIL.safeParse(email).success) ? new Set(emails) : null
}

const EPHEMERAL_SECRET = Symbol.for('pedos/ephemeral-auth-secret')

/** A local run's secret when `.dev.vars` has none: sessions end when the server restarts. */
function ephemeralSecret(): string {
  const scope = globalThis as typeof globalThis & { [EPHEMERAL_SECRET]?: string }
  scope[EPHEMERAL_SECRET] ??= crypto.randomUUID() + crypto.randomUUID()
  return scope[EPHEMERAL_SECRET]
}

/** HMAC-SHA256 of `value` under `secret`, for one purpose (`label`), as hex. */
export async function keyedHash(secret: string, label: string, value: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${label}\0${value}`))
  return [...new Uint8Array(mac)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** How a sign-in code is stored: never the code itself. */
export const hashSignInCode = (secret: string, code: string) =>
  keyedHash(secret, 'sign-in-code', code)

/** An email's row in `rate_limit`: an HMAC of the address, so the table never holds one. */
export async function emailLimitKey(secret: string, email: string): Promise<string> {
  return `email|${await keyedHash(secret, 'email-limit', email.toLowerCase())}`
}

/**
 * Spends one of an email's code slots, atomically, in the `rate_limit` table: true while fewer
 * than `max` codes were sent to it in the current window. For these rows `last_request` is when
 * the window ends. Better Auth deletes every row whose `last_request` is older than its own
 * longest window (10 minutes), which would end an hour's window early if it held the start.
 */
export async function consumeEmailSlot(
  database: D1Database,
  key: string,
  now: number,
  { window, max } = { window: EMAIL_WINDOW_SECONDS, max: CODES_PER_EMAIL }
): Promise<boolean> {
  const row = await database
    .prepare(
      `INSERT INTO rate_limit (id, key, count, last_request) VALUES (?1, ?2, 1, ?3 + ?4)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN ?3 >= rate_limit.last_request THEN 1 ELSE rate_limit.count + 1 END,
         last_request = CASE WHEN ?3 >= rate_limit.last_request THEN ?3 + ?4
           ELSE rate_limit.last_request END
       WHERE ?3 >= rate_limit.last_request OR rate_limit.count < ?5
       RETURNING count`
    )
    .bind(crypto.randomUUID(), key, now, window * 1000, max)
    .first<{ count: number }>()
  return row !== null
}

export type CreateAuthOptions = {
  db: Database
  settings: AuthSettings
  email: EmailSender
}

export function createAuth({ db, settings, email }: CreateAuthOptions) {
  const otp = emailOTP({
    otpLength: 6,
    expiresIn: SIGN_IN_CODE_MINUTES * 60,
    allowedAttempts: SIGN_IN_CODE_ATTEMPTS,
    storeOTP: { hash: code => hashSignInCode(settings.secret, code) },
    // Only sign-in codes reach here: the hook refuses every other type. `to` is lowercased.
    async sendVerificationOTP({ email: to, otp: code }) {
      await email.sendSignInCode(to, code)
    }
  })

  return betterAuth({
    appName: 'Pedos',
    baseURL: settings.baseURL,
    basePath: AUTH_BASE_PATH,
    secret: settings.secret,
    trustedOrigins: settings.trustedOrigins,
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema: { user, session, account, verification, rateLimit }
    }),
    user: {
      additionalFields: {
        // Pedos news by email, on by default (#150). Nobody sets it at sign-in.
        marketingEmail: { type: 'boolean', input: false, required: false, defaultValue: true }
      }
    },
    session: { cookieCache: { enabled: false } },
    emailAndPassword: { enabled: false },
    plugins: [otp],
    rateLimit: { enabled: true, storage: 'database', customRules: RATE_LIMITS },
    telemetry: { enabled: false },
    advanced: {
      cookiePrefix: COOKIE_PREFIX,
      useSecureCookies: settings.useSecureCookies,
      // Explicit, so the checks never depend on NODE_ENV.
      disableCSRFCheck: false,
      disableOriginCheck: false,
      // Cloudflare's own header, which a client can't set.
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] }
    },
    // Better Auth's messages only, never their arguments, which can hold request data.
    logger: {
      log(level, message) {
        console.warn(`auth_log ${JSON.stringify({ level, message: String(message) })}`)
      }
    },
    databaseHooks: {
      user: {
        create: {
          // Staging's sign-up allowlist again, should it have changed since the code was sent.
          async before(created) {
            if (settings.signupAllowlist?.has(created.email) === false) {
              throw APIError.from('BAD_REQUEST', otp.$ERROR_CODES.INVALID_OTP)
            }
          }
        }
      },
      session: {
        create: {
          // A session keeps no IP address or user agent (the privacy page, #150).
          async before(created) {
            return { data: { ...created, ipAddress: null, userAgent: null } }
          }
        }
      }
    },
    hooks: {
      before: createAuthMiddleware(async ctx => {
        const body = (ctx.body ?? {}) as Record<string, unknown>
        if (ctx.path === SEND_CODE_ENDPOINT) {
          // Better Auth swallows delivery errors, so email that goes nowhere refuses up front,
          // the same for every email.
          if (!email.available) {
            throw new APIError('SERVICE_UNAVAILABLE', {
              code: 'OTP_DELIVERY_UNAVAILABLE',
              message: 'Sign-in codes can’t be sent here.'
            })
          }
          refuseOtherFields(body, ['email', 'type'])
          if (body.type !== 'sign-in') {
            throw new APIError('BAD_REQUEST', {
              code: 'UNSUPPORTED_OTP_TYPE',
              message: 'Only sign-in codes are supported.'
            })
          }
          // A missing or malformed email gets Better Auth's own 400, before any slot is spent.
          if (typeof body.email !== 'string') return
          const address = body.email.toLowerCase()
          if (!EMAIL.safeParse(address).success) return
          const key = await emailLimitKey(settings.secret, address)
          const allowed = await consumeEmailSlot(db.$client, key, Date.now())
          // Held by the limit or the allowlist, it answers as a sent code would.
          if (!allowed || settings.signupAllowlist?.has(address) === false) {
            return ctx.json({ success: true })
          }
          return
        }
        if (ctx.path === SIGN_IN_ENDPOINT) {
          refuseOtherFields(body, ['email', 'otp'])
          // A code pasted with spaces or a dash still signs in.
          if (typeof body.otp !== 'string') return
          return { context: { body: { ...body, otp: body.otp.replace(/[\s-]/g, '') } } }
        }
      })
    }
  })
}

export type Auth = ReturnType<typeof createAuth>

function refuseOtherFields(body: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(body).some(field => !allowed.includes(field))) {
    throw new APIError('BAD_REQUEST', {
      code: 'FIELD_NOT_ALLOWED',
      message: `Send only ${allowed.join(' and ')}.`
    })
  }
}

/** Every HTTP route Better Auth registered, for the allowlist's test. */
export function authRoutes(auth: Auth): { methods: string[]; path: string }[] {
  type Routable = { path?: string; options?: { method?: string | string[] } }
  return Object.values(auth.api as Record<string, Routable>).flatMap(endpoint =>
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

/** The Better Auth path a request names, without `/api/auth` and one trailing slash. */
function endpointPath(pathname: string): string | null {
  if (!pathname.startsWith(`${AUTH_BASE_PATH}/`)) return null
  const path = pathname.slice(AUTH_BASE_PATH.length)
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
}

function isServed(method: string, path: string | null): boolean {
  return AUTH_ENDPOINTS.some(endpoint => endpoint.method === method && endpoint.path === path)
}

function failure(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, { status })
}

/**
 * A write from anywhere but the site itself, or not as JSON: refused before Better Auth, which
 * checks `Origin` only when the request carries a cookie. `Sec-Fetch-Site`, when the browser
 * sends it, must be same-origin, and `Origin` must be the environment's own (locally, the
 * request's own loopback origin).
 */
export function crossSiteRefusal(request: Request, settings: AuthSettings): Response | null {
  const site = request.headers.get('sec-fetch-site')
  if (site !== null && site !== 'same-origin') {
    return failure(403, 'CROSS_SITE_REQUEST', 'Requests must come from this site.')
  }
  const url = new URL(request.url)
  const expected = settings.origin ?? (isLocalHost(url.host) ? url.origin : null)
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

type Built = { ok: true; auth: Auth; settings: AuthSettings } | { ok: false; response: Response }

/** Settings and a Better Auth instance for this request, or a 503 when sign-in isn't set up. */
function authFor(request: Request, env: AuthEnv): Built {
  const resolved = resolveAuthSettings(env)
  if (!resolved.ok) {
    console.error(`auth_unavailable ${JSON.stringify({ reason: resolved.reason })}`)
    const response = failure(503, 'AUTH_UNAVAILABLE', 'Sign-in isn’t available right now.')
    return { ok: false, response }
  }
  const { settings } = resolved
  const email = createEmailSender(emailConfig(env, new URL(request.url).host))
  return { ok: true, auth: createAuth({ db: createDatabase(env.DB), settings, email }), settings }
}

/**
 * Serves one `/api/auth/*` request: 404 outside `AUTH_ENDPOINTS`, 503 when sign-in isn't set up
 * here, the write guard for a POST, then Better Auth. Every answer is `private, no-store`.
 */
export async function serveAuthRequest(request: Request, env: AuthEnv): Promise<Response> {
  const url = new URL(request.url)
  const path = endpointPath(url.pathname)
  if (path === null || !isServed(request.method, path)) {
    return noStore(failure(404, 'NOT_FOUND', 'Not found.'))
  }
  const built = authFor(request, env)
  if (!built.ok) return noStore(built.response)
  // `next dev` adds a trailing slash (trailingSlash: true); Better Auth's routes have none.
  const forwardedUrl = new URL(`${AUTH_BASE_PATH}${path}${url.search}`, url)
  const headers = new Headers(request.headers)
  let body: string | undefined
  if (request.method === 'POST') {
    const refused = crossSiteRefusal(request, built.settings)
    if (refused) return noStore(refused)
    body = await request.text()
    if (new TextEncoder().encode(body).length > AUTH_MAX_BYTES) {
      return noStore(failure(413, 'PAYLOAD_TOO_LARGE', 'That request is too large.'))
    }
    headers.delete('content-length')
  }
  const forwarded = new Request(forwardedUrl, { method: request.method, headers, body })
  return noStore(await built.auth.handler(forwarded))
}

/** What the app knows of a signed-in person. */
export type SessionUser = { id: string; email: string; marketingEmail: boolean }

/**
 * The person the request's session cookie names, read from D1 (no cookie cache), or null when
 * there's no valid session. `unavailable` when sign-in isn't set up here.
 */
export async function readSessionUser(
  request: Request,
  env: AuthEnv
): Promise<SessionUser | null | 'unavailable'> {
  const built = authFor(request, env)
  if (!built.ok) return 'unavailable'
  // A local run's base URL comes from the request's host. A Worker's request always carries
  // `Host`; a request built in a test may not, so take it from the URL then.
  const headers = new Headers(request.headers)
  if (!headers.has('host')) headers.set('host', new URL(request.url).host)
  const found = await built.auth.api.getSession({ headers })
  if (!found) return null
  const { id, email, marketingEmail } = found.user as typeof found.user & {
    marketingEmail: boolean
  }
  return { id, email, marketingEmail }
}
