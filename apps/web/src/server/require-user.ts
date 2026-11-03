import { servedOrigin } from '@/lib/site'

import { AuthUnavailableError, type SessionUser } from './auth-session'
import { apiError } from './http'
import { logRouteFailure } from './route-failure'
import { getSessionUser } from './session-user'

async function requireUser(request: Request): Promise<SessionUser | Response> {
  let user: SessionUser | null
  try {
    user = await getSessionUser(request)
  } catch (error) {
    if (error instanceof AuthUnavailableError) return apiError(503, 'auth_unavailable')
    throw error
  }
  return user ?? apiError(401, 'signed_out')
}

function fromOwnPages(request: Request): boolean {
  return request.headers.get('origin') === servedOrigin(request)
}

const READS = new Set(['GET', 'HEAD'])

type Handle<P> = (user: SessionUser, request: Request, params: P) => Promise<Response>

export function userRoute<P = Record<string, never>>(handle: Handle<P>) {
  return async (request: Request, context: { params: Promise<P> }): Promise<Response> => {
    let response: Response
    try {
      const user = await requireUser(request)
      if (user instanceof Response) response = user
      else if (!READS.has(request.method) && !fromOwnPages(request)) {
        response = apiError(403, 'cross_origin')
      } else response = await handle(user, request, await context.params)
    } catch (error) {
      logRouteFailure('user_route_failed', error, request)
      response = apiError(500, 'server_error')
    }
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  }
}
