import { linkParams } from '@/app/[atHandle]/link-params'
import { authSecret } from '@/server/auth'
import { requestStores } from '@/server/library'
import { apiError } from '@/server/require-user'
import { reportShare } from '@/server/sharing'

// Public, outside `src/app/api/`: anyone on a shared Recording's page can report it (ADR 0020).
export const dynamic = 'force-dynamic'

/** Reports the shared Recording for Farty to check. */
export async function POST(
  request: Request,
  { params }: RouteContext<'/[atHandle]/r/[id]/report'>
): Promise<Response> {
  const { handle, id } = await linkParams(params)
  let response: Response
  try {
    // The reporter's limit is keyed by an HMAC under sign-in's secret: none here, no reports.
    const secret = authSecret()
    response = secret
      ? await reportShare('recordings', requestStores(), request, handle, id, secret)
      : apiError(503, 'unavailable')
  } catch {
    console.error('POST share report failed')
    response = Response.json({ error: 'server_error' }, { status: 500 })
  }
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}
