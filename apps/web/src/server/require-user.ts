import { servedOrigin } from '@/lib/site'

import { AuthUnavailableError } from './auth-config'
import { getSessionUser, type SessionUser } from './session-user'

export type { SessionUser } from './session-user'

// Every route under `src/app/api/` except sign-in's own (`api/auth/`) is a user's library, so each
// method is built with `userRoute`, which calls `requireUser()` before anything else.
// `src/app/api/every-route.workers.test.ts` fails on a route that answers without a session.

/** Nothing about a user's library is cached, by the browser or anything between. */
const NO_STORE = 'private, no-store'

/** An error answer: `{ error: code }`, with a fixed code and never request data. */
export function apiError(status: number, error: string): Response {
  return Response.json({ error }, { status })
}

/**
 * The signed-in user, or the answer: 401 when signed out, 503 when sign-in isn't set up here, so a
 * broken deploy isn't taken for a signed-out person.
 */
export async function requireUser(request: Request): Promise<SessionUser | Response> {
  let user: SessionUser | null
  try {
    user = await getSessionUser(request)
  } catch (error) {
    if (error instanceof AuthUnavailableError) return apiError(503, 'auth_unavailable')
    throw error
  }
  return user ?? apiError(401, 'signed_out')
}

/**
 * Whether a write came from this site's own pages. Browsers send `Origin` with every PUT, PATCH and
 * DELETE and pages can't forge it, so a write without this environment's own origin
 * (`servedOrigin`) is refused, even with the session cookie.
 */
function fromOwnPages(request: Request): boolean {
  return request.headers.get('origin') === servedOrigin(request)
}

const READS = new Set(['GET', 'HEAD'])

type Handle<P> = (user: SessionUser, request: Request, params: P) => Promise<Response>

/**
 * A route method behind a signed-in user: `export const PUT = userRoute<{ id: string }>(...)`.
 * It answers 401 without a session (503 when sign-in isn't set up), then 403 to a write from another origin, and only then runs
 * `handle`. Every answer is `private, no-store`. A thrown error answers 500 and logs only the
 * route, since a failed query's message holds its bound values.
 */
export function userRoute<P = Record<string, never>>(handle: Handle<P>) {
  return async (request: Request, context: { params: Promise<P> }): Promise<Response> => {
    let response: Response
    try {
      const user = await requireUser(request)
      if (user instanceof Response) response = user
      else if (!READS.has(request.method) && !fromOwnPages(request)) {
        response = apiError(403, 'cross_origin')
      } else response = await handle(user, request, await context.params)
    } catch {
      console.error(`${request.method} ${new URL(request.url).pathname} failed`)
      response = apiError(500, 'server_error')
    }
    response.headers.set('Cache-Control', NO_STORE)
    return response
  }
}
