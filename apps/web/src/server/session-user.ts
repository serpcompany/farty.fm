import { getSessionUser as readSession } from './auth'
import type { SessionUser } from './auth-session'

export function getSessionUser(request: Request): Promise<SessionUser | null> {
  return readSession(request)
}
