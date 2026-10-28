import { env } from 'cloudflare:test'
import { and, eq, gt } from 'drizzle-orm'

import { createDatabase } from '@/db/database'
import { session, user } from '@/db/schema'
import type { SessionUser } from '@/server/auth-session'

export const TEST_SESSION_COOKIE = 'test_session'

export async function getSessionUser(request: Request): Promise<SessionUser | null> {
  const cookie = request.headers.get('cookie') ?? ''
  const token = cookie.match(new RegExp(`(?:^|;\\s*)${TEST_SESSION_COOKIE}=([^;]+)`))?.[1]
  if (!token) return null
  const rows = await createDatabase(env.DB)
    .select({
      id: user.id,
      email: user.email,
      marketingEmail: user.marketingEmail,
      signedInAt: session.createdAt
    })
    .from(session)
    .innerJoin(user, eq(user.id, session.userId))
    .where(and(eq(session.token, token), gt(session.expiresAt, new Date())))
  return rows[0] ?? null
}
