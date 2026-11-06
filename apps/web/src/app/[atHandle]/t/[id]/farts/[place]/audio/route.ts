import { linkParams } from '@/app/[atHandle]/link-params'
import { requestStores } from '@/server/library'
import { sharedFartAudio } from '@/server/sharing'

// Public, outside `src/app/api/`: anyone with a shared Toot's link plays each of its farts (ADR 0020).
export const dynamic = 'force-dynamic'

/** One fart the shared Toot plays, only the part it plays, while the Toot's link works. */
export async function GET(
  request: Request,
  { params }: RouteContext<'/[atHandle]/t/[id]/farts/[place]/audio'>
): Promise<Response> {
  const { handle, id, place } = await linkParams(params)
  try {
    return await sharedFartAudio(requestStores(), request, handle, id, place)
  } catch {
    console.error('GET shared Toot fart audio failed')
    return Response.json({ error: 'server_error' }, { status: 500 })
  }
}
