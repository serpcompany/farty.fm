import { linkParams } from '@/app/[atHandle]/link-params'
import { requestStores } from '@/server/library'
import { sharedTootRow } from '@/server/sharing'

// Public, outside `src/app/api/`: anyone with a shared Toot's link sees its waveform (ADR 0020).
export const dynamic = 'force-dynamic'

/** What the shared Toot's profile page row draws (#448): its bars, while its link works. */
export async function GET(
  request: Request,
  { params }: RouteContext<'/[atHandle]/t/[id]/row'>
): Promise<Response> {
  const { handle, id } = await linkParams(params)
  try {
    return await sharedTootRow(requestStores(), request, handle, id)
  } catch {
    console.error('GET shared Toot row failed')
    return Response.json({ error: 'server_error' }, { status: 500 })
  }
}
