import type { Kind } from '@/db/library'

import { authSecret } from './auth'
import { apiError } from './http'
import { requestStores } from './library'
import { reportShare } from './reports'
import { logRouteFailure, type RouteFailure } from './route-failure'
import { sharedAudio } from './shared-audio'

type Context<P> = { params: Promise<P> }

function publicRoute<P>(
  code: RouteFailure,
  handle: (request: Request, params: P) => Promise<Response>
) {
  return async (request: Request, context: Context<P>): Promise<Response> => {
    try {
      return await handle(request, await context.params)
    } catch (error) {
      logRouteFailure(code, error, request)
      return apiError(500, 'server_error')
    }
  }
}

export function reportRoute<P>(
  report: (request: Request, params: P, secret: string) => Promise<Response>
) {
  const route = publicRoute<P>('report_failed', (request, params) => {
    const secret = authSecret()
    return secret ? report(request, params, secret) : Promise.resolve(apiError(503, 'unavailable'))
  })
  return async (request: Request, context: Context<P>): Promise<Response> => {
    const response = await route(request, context)
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  }
}

type SharedLink = { handle: string; id: string }

export const sharedAudioRoute = (kind: Kind) =>
  publicRoute<SharedLink>('shared_audio_failed', (request, { handle, id }) =>
    sharedAudio(kind, requestStores(), request, handle, id)
  )

export const shareReportRoute = (kind: Kind) =>
  reportRoute<SharedLink>((request, { handle, id }, secret) =>
    reportShare(kind, requestStores(), request, handle, id, secret)
  )
