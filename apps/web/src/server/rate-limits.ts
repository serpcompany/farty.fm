import { GET_SESSION_ENDPOINT, SEND_CODE_ENDPOINT, SIGN_IN_ENDPOINT } from './auth-endpoints'
import { keyedHash } from './hmac'

export type SlotRule = { window: number; max: number }
type SlotResult = { allowed: boolean; retryAfter: number | null }

export const RATE_LIMITS = {
  [SEND_CODE_ENDPOINT]: { window: 10 * 60, max: 10 },
  [SIGN_IN_ENDPOINT]: { window: 60, max: 10 },
  [GET_SESSION_ENDPOINT]: false
} as const

const HOUR = 60 * 60

export const LIMITS = {
  codesPerEmailAndClient: { window: HOUR, max: 5 },
  codesPerEmail: { window: HOUR, max: 20 },
  codesPerNetwork: { window: HOUR, max: 30 },
  codesSiteWide: { window: HOUR, max: 300 },
  signInsPerClient: { window: HOUR, max: 60 }
} as const satisfies Record<string, SlotRule>

export const SITE_CODES_KEY = 'site|send-code'

export async function emailLimitKey(secret: string, email: string): Promise<string> {
  return `email|${await keyedHash(secret, 'email-limit', email.toLowerCase())}`
}

export async function emailClientLimitKey(
  secret: string,
  email: string,
  client: string
): Promise<string> {
  const value = `${email.toLowerCase()}\0${client}`
  return `email-client|${await keyedHash(secret, 'email-client-limit', value)}`
}

function networkOf(client: string): string {
  const groups = client.split(':')
  return groups.length === 8 ? `${groups.slice(0, 3).join(':')}::/48` : client
}

export async function networkLimitKey(secret: string, client: string): Promise<string> {
  return `network|${await keyedHash(secret, 'network-limit', networkOf(client))}`
}

export async function signInClientLimitKey(secret: string, client: string): Promise<string> {
  return `sign-in-client|${await keyedHash(secret, 'sign-in-client-limit', client)}`
}

export async function clientLimitKey(secret: string, betterAuthKey: string): Promise<string> {
  return `client|${await keyedHash(secret, 'client-limit', betterAuthKey)}`
}

export async function consumeSlot(
  database: D1Database,
  key: string,
  now: number,
  { window, max }: SlotRule
): Promise<SlotResult> {
  const windowEnd = now + window * 1000
  const [, spent, row] = await database.batch<{ count?: number; last_request?: number }>([
    database.prepare('DELETE FROM rate_limit WHERE last_request <= ?1').bind(now),
    database
      .prepare(
        `INSERT INTO rate_limit (id, key, count, last_request) VALUES (?1, ?2, 1, ?3)
         ON CONFLICT (key) DO UPDATE SET count = rate_limit.count + 1
         WHERE rate_limit.count < ?4
         RETURNING count`
      )
      .bind(crypto.randomUUID(), key, windowEnd, max),
    database.prepare('SELECT last_request FROM rate_limit WHERE key = ?1').bind(key)
  ])
  if (spent.results.length > 0) return { allowed: true, retryAfter: null }
  const ends = row.results[0]?.last_request ?? windowEnd
  return { allowed: false, retryAfter: Math.max(1, Math.ceil((ends - now) / 1000)) }
}

export function logSiteCodeLimit(retryAfter: number | null): void {
  const { max, window } = LIMITS.codesSiteWide
  const fields = { max, windowSeconds: window, retryAfterSeconds: retryAfter }
  console.warn(`auth_site_code_limit ${JSON.stringify(fields)}`)
}

export function clientLimitStorage(database: D1Database, secret: string) {
  return {
    async consume(key: string, rule: SlotRule): Promise<SlotResult> {
      return consumeSlot(database, await clientLimitKey(secret, key), Date.now(), rule)
    }
  }
}
