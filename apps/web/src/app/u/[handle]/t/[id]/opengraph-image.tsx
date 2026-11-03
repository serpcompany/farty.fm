import { LINK_IMAGE_SIZE, linkImage, linkImageNotFound } from '@/server/link-preview'
import { SHARED_TOOT_BARS } from '@/server/sharing'
import { sharedTootView } from './shared'

// The shared Toot's link image (ADR 0020), 1200×630, as a shared Recording's: Farty's pink, the
// Toot's title, who shared it, and its waveform. Drawn from D1 on each request, so a link that
// stops working takes its image with it.
export const dynamic = 'force-dynamic'
export const alt = 'A fart song on Farty'
export const size = LINK_IMAGE_SIZE
export const contentType = 'image/png'

export default async function Image({
  params
}: {
  params: Promise<{ handle: string; id: string }>
}) {
  const { handle, id } = await params
  const view = await sharedTootView(handle, id)
  if (!view) return linkImageNotFound()
  return linkImage({
    name: view.title,
    byline: `A fart song by @${view.handle}`,
    pill: null,
    levels: view.levels,
    bars: SHARED_TOOT_BARS
  })
}
