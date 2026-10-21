import { getSessionUser as readSession } from './auth'

/** Who is signed in: the session's user. Only the id is needed to scope a request. */
export type SessionUser = { id: string }

/**
 * The signed-in user of `request`, or null. The one place `requireUser()` takes its session from:
 * sign-in's own (`./auth`), read from D1 on every request. Throws `AuthUnavailableError` when
 * sign-in isn't set up here, which `requireUser()` answers 503. The `workers` tests of the library
 * replace this module with `vi.mock`; `signed-in.workers.test.ts` runs it for real.
 */
export function getSessionUser(request: Request): Promise<SessionUser | null> {
  return readSession(request)
}
