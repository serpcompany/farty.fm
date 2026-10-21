import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware, getIP } from 'better-auth/api'
import { type BetterAuthOptions, betterAuth } from 'better-auth/minimal'
import { emailOTP } from 'better-auth/plugins/email-otp'
import { z } from 'zod'

import { createDatabase, type Database } from '@/db/database'
import { account, rateLimit, session, user, verification } from '@/db/schema'

import {
  createEmailSender,
  type EmailEnv,
  type EmailSender,
  emailConfig,
  SIGN_IN_CODE_ATTEMPTS,
  SIGN_IN_CODE_LENGTH,
  SIGN_IN_CODE_MINUTES
} from './email'
import { deployment, isLocalHost } from './environment'

/**
 * Sign-in for Farty (#152; SERP's better-auth standard, with serp.app's `src/server/auth/` as the
 * reference): a 6-digit code by email, and the first sign-in creates the account. No passwords.
 * No Next.js imports, so the tests run this file on a real local D1 (`auth-config.test.ts`).
 *
 * - **Four endpoints** (`AUTH_ENDPOINTS`): send a code, sign in with it, read the session, sign
 *   out. Every other Better Auth route answers 404 before Better Auth sees the request.
 * - **Writes** must come from the site itself (`crossSiteRefusal`), as JSON. Better Auth's own
 *   origin and CSRF checks also run, forced on (Better Auth skips them under `NODE_ENV=test`).
 * - **Codes** are 6 digits, live 10 minutes, allow 3 guesses, and are stored only as an HMAC
 *   keyed by `BETTER_AUTH_SECRET`, so a copy of the database can't be brute-forced into codes.
 * - **Limits** live in D1's `rate_limit` table, keyed by HMACs, never an email or IP address:
 *   Better Auth's per-client limits (`RATE_LIMITS`, a 429) and the hook's own (`LIMITS`): codes per
 *   email and client, per email, site-wide, and sign-in guesses per client an hour. A request the
 *   site-wide one holds logs `auth_site_code_limit`.
 * - **No answer says whether an email has an account.** A code request for any valid email answers
 *   `{ success: true }`, sent or not (a per-email or site-wide limit, Staging's sign-up allowlist),
 *   and every wrong guess answers `INVALID_OTP`.
 * - **Sessions** last 7 days, are read from D1 on every request (no cookie cache), and keep no IP
 *   address or user agent.
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

export type SlotRule = { window: number; max: number }

/**
 * Per client (an IPv4 address or an IPv6 /64, from `cf-connecting-ip` only), by Better Auth's
 * limiter on `rate_limit` (`clientLimitStorage`). Over one, a 429. `false` turns it off for a path.
 */
export const RATE_LIMITS = {
  [SEND_CODE_ENDPOINT]: { window: 10 * 60, max: 10 },
  [SIGN_IN_ENDPOINT]: { window: 60, max: 10 },
  // Every page load asks, so no D1 write each time.
  [GET_SESSION_ENDPOINT]: false
} as const

const HOUR = 60 * 60

/**
 * The hook's own limits, each a row in `rate_limit` (`consumeSlot`). Past a code limit, the
 * request answers like a sent code and nothing is sent; past the sign-in one, a 429.
 */
export const LIMITS = {
  /** Codes to one email from one client: one client can't spend an email's codes. */
  codesPerEmailAndClient: { window: HOUR, max: 5 },
  /** Codes to one email from every client together. */
  codesPerEmail: { window: HOUR, max: 20 },
  /** Code emails the whole site sends. */
  codesSiteWide: { window: HOUR, max: 300 },
  /** Code guesses from one client, beside Better Auth's 10 a minute. */
  signInsPerClient: { window: HOUR, max: 60 }
} as const satisfies Record<string, SlotRule>

/** Far above any sign-in body, far below anything that costs memory. */
export const AUTH_MAX_BYTES = 16 * 1024

/** A session lasts 7 days, and moves to 7 days from now when it's read a day or more after. */
export const SESSION_EXPIRES_SECONDS = 7 * 24 * HOUR
export const SESSION_UPDATE_AGE_SECONDS = 24 * HOUR

const COOKIE_PREFIX = 'pedos'
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

// Every `rate_limit` key is a label and an HMAC under the secret: the table never holds an email
// or an IP address.

/** An email's row, across every client: `email|<HMAC of the lowercased address>`. */
export async function emailLimitKey(secret: string, email: string): Promise<string> {
  return `email|${await keyedHash(secret, 'email-limit', email.toLowerCase())}`
}

/** An email's row for one client. */
export async function emailClientLimitKey(
  secret: string,
  email: string,
  client: string
): Promise<string> {
  const value = `${email.toLowerCase()}\0${client}`
  return `email-client|${await keyedHash(secret, 'email-client-limit', value)}`
}

/** A client's row for sign-in guesses an hour. */
export async function signInClientLimitKey(secret: string, client: string): Promise<string> {
  return `sign-in-client|${await keyedHash(secret, 'sign-in-client-limit', client)}`
}

/** Better Auth's per-client row, from its own `<client>|<path>` key. */
export async function clientLimitKey(secret: string, betterAuthKey: string): Promise<string> {
  return `client|${await keyedHash(secret, 'client-limit', betterAuthKey)}`
}

/** The site's one row for code emails. */
export const SITE_CODES_KEY = 'site|send-code'

/** The client Better Auth's limiter sees: `cf-connecting-ip`, an IPv6 address cut to its /64. */
function clientOf(request: Request | undefined, options: BetterAuthOptions): string {
  return (request && getIP(request, options)) || 'no-trusted-ip'
}

export type SlotResult = { allowed: boolean; retryAfter: number | null }

/**
 * Spends one slot of `key`'s window, atomically, in `rate_limit`: allowed while fewer than `max`
 * were spent in the window, which starts at the first and lasts `window` seconds. Each row's
 * `last_request` holds when its window ends, and every call first deletes the rows whose window
 * has ended, so no row outlasts its window by more than the time to the next request. Each
 * statement goes through an index (`rate_limit_last_request_idx`, and the unique one on `key`), so
 * a call never reads every live row.
 */
export async function consumeSlot(
  database: D1Database,
  key: string,
  now: number,
  { window, max }: SlotRule
): Promise<SlotResult> {
  const [, spent, row] = await database.batch<{ count?: number; last_request?: number }>([
    database.prepare('DELETE FROM rate_limit WHERE last_request <= ?1').bind(now),
    database
      .prepare(
        `INSERT INTO rate_limit (id, key, count, last_request) VALUES (?1, ?2, 1, ?3)
         ON CONFLICT (key) DO UPDATE SET count = rate_limit.count + 1
         WHERE rate_limit.count < ?4
         RETURNING count`
      )
      .bind(crypto.randomUUID(), key, now + window * 1000, max),
    database.prepare('SELECT last_request FROM rate_limit WHERE key = ?1').bind(key)
  ])
  if (spent.results.length > 0) return { allowed: true, retryAfter: null }
  const ends = row.results[0]?.last_request ?? now + window * 1000
  return { allowed: false, retryAfter: Math.max(1, Math.ceil((ends - now) / 1000)) }
}

/**
 * The site-wide code limit held a request: one line with the limit and the seconds until its
 * window ends, never an email, a client or a key. Every held request logs it until then.
 */
function logSiteCodeLimit(retryAfter: number | null): void {
  const { max, window } = LIMITS.codesSiteWide
  const fields = { max, windowSeconds: window, retryAfterSeconds: retryAfter }
  console.warn(`auth_site_code_limit ${JSON.stringify(fields)}`)
}

/** Better Auth's per-client limiter, on `consumeSlot` with HMAC keys. */
function clientLimitStorage(database: D1Database, secret: string) {
  return {
    async consume(key: string, rule: SlotRule): Promise<SlotResult> {
      return consumeSlot(database, await clientLimitKey(secret, key), Date.now(), rule)
    }
  }
}

export type CreateAuthOptions = {
  db: Database
  settings: AuthSettings
  email: EmailSender
}

export function createAuth({ db, settings, email }: CreateAuthOptions) {
  const otp = emailOTP({
    otpLength: SIGN_IN_CODE_LENGTH,
    expiresIn: SIGN_IN_CODE_MINUTES * 60,
    allowedAttempts: SIGN_IN_CODE_ATTEMPTS,
    storeOTP: { hash: code => hashSignInCode(settings.secret, code) },
    // Only sign-in codes reach here: the hook refuses every other type. `to` is lowercased.
    async sendVerificationOTP({ email: to, otp: code }) {
      await email.sendSignInCode(to, code)
    }
  })

  return betterAuth({
    appName: 'Farty',
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
        // Farty news by email, on by default (#150). Nobody sets it at sign-in.
        marketingEmail: { type: 'boolean', input: false, required: false, defaultValue: true }
      }
    },
    session: {
      expiresIn: SESSION_EXPIRES_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
      cookieCache: { enabled: false }
    },
    emailAndPassword: { enabled: false },
    plugins: [otp],
    rateLimit: {
      enabled: true,
      customRules: RATE_LIMITS,
      customStorage: clientLimitStorage(db.$client, settings.secret)
    },
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
          // Refused here, so no code goes out unless this check passed, whatever Better Auth's
          // own check would say.
          const address = typeof body.email === 'string' ? body.email.toLowerCase() : null
          if (address === null || !EMAIL.safeParse(address).success) {
            throw new APIError('BAD_REQUEST', {
              code: 'INVALID_EMAIL',
              message: 'Enter a valid email address.'
            })
          }
          const client = clientOf(ctx.request, ctx.context.options)
          const now = Date.now()
          const spend = (key: string, rule: SlotRule) => consumeSlot(db.$client, key, now, rule)
          // Held by a limit or the allowlist, it answers as a sent code would.
          const held = () => ctx.json({ success: true })
          // In order, each spent only when the ones before allow it: one client's requests past
          // its 5 don't spend the email's 20, and the site's count is last, so it counts only
          // codes that go out. `auth-config.test.ts` pins the order.
          const perClient = await emailClientLimitKey(settings.secret, address, client)
          if (!(await spend(perClient, LIMITS.codesPerEmailAndClient)).allowed) return held()
          const perEmail = await emailLimitKey(settings.secret, address)
          if (!(await spend(perEmail, LIMITS.codesPerEmail)).allowed) return held()
          if (settings.signupAllowlist?.has(address) === false) return held()
          const site = await spend(SITE_CODES_KEY, LIMITS.codesSiteWide)
          if (!site.allowed) {
            // Nobody gets a code until the window ends, so say so, with no address or client.
            logSiteCodeLimit(site.retryAfter)
            return held()
          }
          return
        }
        if (ctx.path === SIGN_IN_ENDPOINT) {
          refuseOtherFields(body, ['email', 'otp'])
          const client = clientOf(ctx.request, ctx.context.options)
          const key = await signInClientLimitKey(settings.secret, client)
          const { allowed, retryAfter } = await consumeSlot(
            db.$client,
            key,
            Date.now(),
            LIMITS.signInsPerClient
          )
          if (!allowed) {
            // As Better Auth's own limiter answers.
            throw new APIError(
              'TOO_MANY_REQUESTS',
              { message: 'Too many requests. Please try again later.' },
              { 'X-Retry-After': String(retryAfter) }
            )
          }
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
  let body: Uint8Array<ArrayBuffer> | undefined
  if (request.method === 'POST') {
    const refused = crossSiteRefusal(request, built.settings)
    if (refused) return noStore(refused)
    const read = await readCapped(request, AUTH_MAX_BYTES)
    if (read === null) {
      return noStore(failure(413, 'PAYLOAD_TOO_LARGE', 'That request is too large.'))
    }
    body = read
    headers.delete('content-length')
  }
  const forwarded = new Request(forwardedUrl, { method: request.method, headers, body })
  return noStore(await built.auth.handler(forwarded))
}

/**
 * The request's body, or null past `max` bytes: refused on its `Content-Length` before any of it
 * is read, and otherwise counted as it streams in and cancelled once past `max`, so a body
 * without a length can't be buffered whole either.
 */
export async function readCapped(
  request: Request,
  max: number
): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (!(declared <= max)) {
    await request.body?.cancel()
    return null
  }
  const body = new Uint8Array(max)
  let length = 0
  if (request.body) {
    const reader = request.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (length + value.byteLength > max) {
        await reader.cancel()
        return null
      }
      body.set(value, length)
      length += value.byteLength
    }
  }
  return body.subarray(0, length)
}

/** What the app knows of a signed-in person. */
export type SessionUser = { id: string; email: string; marketingEmail: boolean }

/**
 * Sign-in isn't set up in this environment (no secret, a wrong `BETTER_AUTH_URL` or `SITE_ENV`):
 * answer 503, never 401, so a client doesn't take a broken deploy for a signed-out person.
 */
export class AuthUnavailableError extends Error {
  readonly status = 503
  constructor() {
    super('Sign-in isn’t available right now.')
    this.name = 'AuthUnavailableError'
  }
}

/**
 * The person the request's session cookie names, read from D1 on every call (no cookie cache):
 * `{ id, email, marketingEmail }` when signed in, null when signed out (no cookie, a forged or
 * expired one). Throws `AuthUnavailableError` when sign-in isn't set up here, for the caller to
 * answer 503. Reading a session a day or more old moves its expiry in D1 to 7 days from now; only
 * Better Auth's `GET /api/auth/get-session` also re-sets the cookie.
 */
export async function readSessionUser(request: Request, env: AuthEnv): Promise<SessionUser | null> {
  const built = authFor(request, env)
  if (!built.ok) throw new AuthUnavailableError()
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
