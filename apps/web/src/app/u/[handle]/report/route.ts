import { authSecret } from '@/server/auth'
import { requestStores } from '@/server/library'
import { reportProfile } from '@/server/profiles'
import { apiError } from '@/server/require-user'

// Public, outside `src/app/api/`: anyone on a profile page can report it (ADR 0021).
export const dynamic = 'force-dynamic'

/** Reports the profile page for Farty to check. */
export async function POST(
  request: Request,
  { params }: RouteContext<'/u/[handle]/report'>
): Promise<Response> {
  const { handle } = await params
  let response: Response
  try {
    // The reporter's limit is keyed by an HMAC under sign-in's secret: none here, no reports.
    const secret = authSecret()
    response = secret
      ? await reportProfile(requestStores(), request, handle, secret)
      : apiError(503, 'unavailable')
  } catch {
    console.error('POST profile report failed')
    response = Response.json({ error: 'server_error' }, { status: 500 })
  }
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}
