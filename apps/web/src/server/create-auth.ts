import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError } from 'better-auth/api'
import { betterAuth } from 'better-auth/minimal'
import { captcha } from 'better-auth/plugins'
import { emailOTP } from 'better-auth/plugins/email-otp'

import { createDatabase, type Database } from '@/db/database'
import { account, rateLimit, session, user, verification } from '@/db/schema'

import { AUTH_BASE_PATH, SEND_CODE_ENDPOINT } from './auth-endpoints'
import { signInGuard } from './auth-hooks'
import { type AuthEnv, type AuthSettings, availableAuthSettings } from './auth-settings'
import {
  createEmailSender,
  type EmailSender,
  emailConfig,
  SIGN_IN_CODE_ATTEMPTS,
  SIGN_IN_CODE_LENGTH,
  SIGN_IN_CODE_MINUTES
} from './email'
import { keyedHash } from './hmac'
import { clientLimitStorage, RATE_LIMITS } from './rate-limits'

const HOUR = 60 * 60
export const SESSION_EXPIRES_SECONDS = 7 * 24 * HOUR
export const SESSION_UPDATE_AGE_SECONDS = 24 * HOUR

export const hashSignInCode = (secret: string, code: string) =>
  keyedHash(secret, 'sign-in-code', code)

type CreateAuthOptions = {
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
        marketingEmail: { type: 'boolean', input: false, required: false, defaultValue: true }
      }
    },
    session: {
      expiresIn: SESSION_EXPIRES_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
      cookieCache: { enabled: false }
    },
    emailAndPassword: { enabled: false },
    plugins: settings.turnstile
      ? [
          otp,
          captcha({
            provider: 'cloudflare-turnstile',
            secretKey: settings.turnstile.secretKey,
            endpoints: [SEND_CODE_ENDPOINT]
          })
        ]
      : [otp],
    rateLimit: {
      enabled: true,
      customRules: RATE_LIMITS,
      customStorage: clientLimitStorage(db.$client, settings.secret)
    },
    telemetry: { enabled: false },
    advanced: {
      cookiePrefix: 'pedos',
      useSecureCookies: settings.useSecureCookies,
      disableCSRFCheck: false,
      disableOriginCheck: false,
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] }
    },
    logger: {
      log(level, message) {
        console.warn(`auth_log ${JSON.stringify({ level, message: String(message) })}`)
      }
    },
    databaseHooks: {
      user: {
        create: {
          async before(created) {
            if (settings.signupAllowlist?.has(created.email) === false) {
              throw APIError.from('BAD_REQUEST', otp.$ERROR_CODES.INVALID_OTP)
            }
          }
        }
      },
      session: {
        create: {
          async before(created) {
            return { data: { ...created, ipAddress: null, userAgent: null } }
          }
        }
      }
    },
    hooks: { before: signInGuard({ database: db.$client, settings, email }) }
  })
}

type Auth = ReturnType<typeof createAuth>

export function authFor(
  request: Request,
  env: AuthEnv
): { auth: Auth; settings: AuthSettings } | null {
  const settings = availableAuthSettings(env)
  if (!settings) return null
  const email = createEmailSender(emailConfig(env, new URL(request.url).host))
  return { auth: createAuth({ db: createDatabase(env.DB), settings, email }), settings }
}
