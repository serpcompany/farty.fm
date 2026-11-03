import { requestStores } from '@/server/library'
import { sharedAudio } from '@/server/sharing'

// Public, outside `src/app/api/`: anyone with a shared Toot's link plays it (ADR 0020).
export const dynamic = 'force-dynamic'

/** The shared Toot's saved WAV, as stored, while its link works. */
export async function GET(
  request: Request,
  { params }: RouteContext<'/u/[handle]/t/[id]/audio'>
): Promise<Response> {
  const { handle, id } = await params
  try {
    return await sharedAudio('toots', requestStores(), request, handle, id)
  } catch {
    console.error('GET shared Toot audio failed')
    return Response.json({ error: 'server_error' }, { status: 500 })
  }
}
