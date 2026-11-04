import { authSecret } from '@/server/auth'
import { requestStores } from '@/server/library'
import { apiError } from '@/server/require-user'
import { reportSong } from '@/server/song-reports'

// Public: anyone in Song Creator or on a locked Song's sheet can report the Song, guests too
// (#358), so it reads no session. `every-route.workers.test.ts` leaves it out; its own tests are
// in `song-reports.workers.test.ts`.
export const dynamic = 'force-dynamic'

/** Reports that the Song is wrong, for Farty to fix the catalog by. */
export async function POST(
  request: Request,
  { params }: RouteContext<'/api/songs/[id]/report'>
): Promise<Response> {
  const { id } = await params
  let response: Response
  try {
    // The reporter's limit is keyed by an HMAC under sign-in's secret: none here, no reports.
    const secret = authSecret()
    response = secret
      ? await reportSong(requestStores(), request, id, secret)
      : apiError(503, 'unavailable')
  } catch {
    console.error('POST song report failed')
    response = Response.json({ error: 'server_error' }, { status: 500 })
  }
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}
