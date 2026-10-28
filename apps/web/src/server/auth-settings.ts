import { z } from 'zod'

import type { EmailEnv } from './email'
import { deployment } from './environment'

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
  writeOrigin: string | null
  signupAllowlist: ReadonlySet<string> | null
}

type AuthSettingsResult =
  | { ok: true; settings: AuthSettings }
  | {
      ok: false
      reason:
        | 'deployment_not_configured'
        | 'auth_secret_missing'
        | 'auth_url_invalid'
        | 'signup_allowlist_invalid'
    }

const MIN_SECRET_LENGTH = 32
const LOCAL_HOST_PATTERNS = ['localhost', '127.0.0.1', '[::1]'].flatMap(host => [host, `${host}:*`])
const EMAIL = z.email()

export const isEmail = (value: string) => EMAIL.safeParse(value).success

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
      secret: secret ?? restartScopedSecret(),
      useSecureCookies: false,
      writeOrigin: null,
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
    writeOrigin: target.origin,
    signupAllowlist
  }
  return { ok: true, settings }
}

function parseAllowlist(value: unknown): ReadonlySet<string> | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const emails = value.split(',').map(email => email.trim().toLowerCase())
  return emails.every(isEmail) ? new Set(emails) : null
}

const RESTART_SCOPED_SECRET = Symbol.for('pedos/ephemeral-auth-secret')

function restartScopedSecret(): string {
  const scope = globalThis as typeof globalThis & { [RESTART_SCOPED_SECRET]?: string }
  scope[RESTART_SCOPED_SECRET] ??= crypto.randomUUID() + crypto.randomUUID()
  return scope[RESTART_SCOPED_SECRET]
}
