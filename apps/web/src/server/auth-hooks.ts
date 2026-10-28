import { APIError, createAuthMiddleware, getIP } from 'better-auth/api'
import type { BetterAuthOptions } from 'better-auth/minimal'

import { SEND_CODE_ENDPOINT, SIGN_IN_ENDPOINT } from './auth-endpoints'
import { type AuthSettings, isEmail } from './auth-settings'
import type { EmailSender } from './email'
import {
  consumeSlot,
  emailClientLimitKey,
  emailLimitKey,
  LIMITS,
  logSiteCodeLimit,
  SITE_CODES_KEY,
  type SlotRule,
  signInClientLimitKey
} from './rate-limits'

type Guarded = {
  database: D1Database
  settings: AuthSettings
  email: EmailSender
}

type Body = Record<string, unknown>

function clientOf(request: Request | undefined, options: BetterAuthOptions): string {
  return (request && getIP(request, options)) || 'no-trusted-ip'
}

function refuseOtherFields(body: Body, allowed: readonly string[]): void {
  if (Object.keys(body).some(field => !allowed.includes(field))) {
    throw new APIError('BAD_REQUEST', {
      code: 'FIELD_NOT_ALLOWED',
      message: `Send only ${allowed.join(' and ')}.`
    })
  }
}

function signInCodeAddress(body: Body): string {
  refuseOtherFields(body, ['email', 'type'])
  if (body.type !== 'sign-in') {
    throw new APIError('BAD_REQUEST', {
      code: 'UNSUPPORTED_OTP_TYPE',
      message: 'Only sign-in codes are supported.'
    })
  }
  const address = typeof body.email === 'string' ? body.email.toLowerCase() : null
  if (address === null || !isEmail(address)) {
    throw new APIError('BAD_REQUEST', {
      code: 'INVALID_EMAIL',
      message: 'Enter a valid email address.'
    })
  }
  return address
}

async function codeMayGoOut(
  { database, settings }: Guarded,
  address: string,
  client: string
): Promise<boolean> {
  const now = Date.now()
  const spend = async (key: string, rule: SlotRule) =>
    (await consumeSlot(database, key, now, rule)).allowed
  const perClient = await emailClientLimitKey(settings.secret, address, client)
  if (!(await spend(perClient, LIMITS.codesPerEmailAndClient))) return false
  const perEmail = await emailLimitKey(settings.secret, address)
  if (!(await spend(perEmail, LIMITS.codesPerEmail))) return false
  if (settings.signupAllowlist?.has(address) === false) return false
  const site = await consumeSlot(database, SITE_CODES_KEY, now, LIMITS.codesSiteWide)
  if (!site.allowed) logSiteCodeLimit(site.retryAfter)
  return site.allowed
}

async function refuseGuessesPastLimit({ database, settings }: Guarded, client: string) {
  const key = await signInClientLimitKey(settings.secret, client)
  const { allowed, retryAfter } = await consumeSlot(
    database,
    key,
    Date.now(),
    LIMITS.signInsPerClient
  )
  if (!allowed) {
    throw new APIError(
      'TOO_MANY_REQUESTS',
      { message: 'Too many requests. Please try again later.' },
      { 'X-Retry-After': String(retryAfter) }
    )
  }
}

export function signInGuard(guarded: Guarded) {
  return createAuthMiddleware(async ctx => {
    const body = (ctx.body ?? {}) as Body
    if (ctx.path === SEND_CODE_ENDPOINT) {
      if (!guarded.email.available) {
        throw new APIError('SERVICE_UNAVAILABLE', {
          code: 'OTP_DELIVERY_UNAVAILABLE',
          message: 'Sign-in codes can’t be sent here.'
        })
      }
      const address = signInCodeAddress(body)
      const client = clientOf(ctx.request, ctx.context.options)
      if (!(await codeMayGoOut(guarded, address, client))) return ctx.json({ success: true })
      return
    }
    if (ctx.path === SIGN_IN_ENDPOINT) {
      refuseOtherFields(body, ['email', 'otp'])
      await refuseGuessesPastLimit(guarded, clientOf(ctx.request, ctx.context.options))
      if (typeof body.otp !== 'string') return
      return { context: { body: { ...body, otp: body.otp.replace(/[\s-]/g, '') } } }
    }
  })
}
