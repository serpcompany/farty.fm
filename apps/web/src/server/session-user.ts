/** Who is signed in: the session's user. Only the id is needed to scope a request. */
export type SessionUser = { id: string }

/**
 * The signed-in user of `request`, or null. The one place `requireUser()` takes its session from.
 *
 * Until sign-in (#152) merges, nobody is signed in, so every library route answers 401. Whichever
 * of #152 and #153 merges second makes this return `getSessionUser(request)` from `./auth`, which
 * reads the session from D1 on every request. Tests replace this module with `vi.mock`.
 */
export async function getSessionUser(_request: Request): Promise<SessionUser | null> {
  return null
}
