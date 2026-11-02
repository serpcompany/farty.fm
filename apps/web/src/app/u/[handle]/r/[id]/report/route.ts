import { requestStores } from '@/server/library'
import { reportShare } from '@/server/sharing'

// Public, outside `src/app/api/`: anyone on a shared Recording's page can report it (ADR 0020).
export const dynamic = 'force-dynamic'

/** Reports the shared Recording for Farty to check. */
export async function POST(
  request: Request,
  { params }: RouteContext<'/u/[handle]/r/[id]/report'>
): Promise<Response> {
  const { handle, id } = await params
  let response: Response
  try {
    response = await reportShare(requestStores(), request, handle, id)
  } catch {
    console.error('POST share report failed')
    response = Response.json({ error: 'server_error' }, { status: 500 })
  }
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}
