import type { AuthEnv } from './auth-settings'
import { authFor } from './create-auth'

export type SessionUser = { id: string; email: string; marketingEmail: boolean; signedInAt: Date }

export const RECENT_SIGN_IN_MINUTES = 10

export function signedInRecently(user: SessionUser, now = Date.now()): boolean {
  return now - user.signedInAt.getTime() < RECENT_SIGN_IN_MINUTES * 60_000
}

export class AuthUnavailableError extends Error {
  constructor() {
    super('Sign-in isn’t available right now.')
    this.name = 'AuthUnavailableError'
  }
}

export async function readSessionUser(request: Request, env: AuthEnv): Promise<SessionUser | null> {
  const built = authFor(request, env)
  if (!built) throw new AuthUnavailableError()
  const headers = new Headers(request.headers)
  if (!headers.has('host')) headers.set('host', new URL(request.url).host)
  const found = await built.auth.api.getSession({ headers })
  if (!found) return null
  const { id, email, marketingEmail } = found.user as typeof found.user & {
    marketingEmail: boolean
  }
  return { id, email, marketingEmail, signedInAt: new Date(found.session.createdAt) }
}
