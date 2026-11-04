import { linkParams } from '@/app/[atHandle]/link-params'
import { requestStores } from '@/server/library'
import { sharedAudio } from '@/server/sharing'

// Public, outside `src/app/api/`: anyone with a shared Recording's link plays it (ADR 0020).
export const dynamic = 'force-dynamic'

/** The shared Recording's WAV, while its link works. */
export async function GET(
  request: Request,
  { params }: RouteContext<'/[atHandle]/r/[id]/audio'>
): Promise<Response> {
  const { handle, id } = await linkParams(params)
  try {
    return await sharedAudio('recordings', requestStores(), request, handle, id)
  } catch {
    console.error('GET shared audio failed')
    return Response.json({ error: 'server_error' }, { status: 500 })
  }
}
