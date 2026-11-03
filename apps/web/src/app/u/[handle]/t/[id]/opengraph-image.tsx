import { LINK_IMAGE_SIZE, linkImage, linkImageNotFound } from '@/server/link-preview'
import { SHARED_TOOT_BARS } from '@/server/shared-audio'
import { sharedTootView } from './shared'

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
