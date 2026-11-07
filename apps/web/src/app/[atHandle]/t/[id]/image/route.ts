import { linkParams } from '@/app/[atHandle]/link-params'
import { linkImage, linkImageNotFound } from '@/server/link-preview'
import { SHARED_TOOT_BARS } from '@/server/sharing'
import { sharedTootLevelsView, sharedTootView } from '../shared'

// The shared Toot's link image (ADR 0020), 1200×630, as a shared Recording's: Farty's pink, the
// Toot's title, who shared it, and its waveform. Drawn from D1 on each request, so a link that
// stops working takes its image with it.
export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: RouteContext<'/[atHandle]/t/[id]/image'>
): Promise<Response> {
  const { handle, id } = await linkParams(params)
  const [view, levels] = await Promise.all([
    sharedTootView(handle, id),
    sharedTootLevelsView(handle, id)
  ])
  if (!view || !levels) return linkImageNotFound()
  return linkImage({
    name: view.title,
    byline: `A fart song by @${view.handle}`,
    pill: null,
    levels,
    bars: SHARED_TOOT_BARS
  })
}
