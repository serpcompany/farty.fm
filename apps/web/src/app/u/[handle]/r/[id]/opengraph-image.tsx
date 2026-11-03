import { LINK_IMAGE_SIZE, linkImage, linkImageNotFound } from '@/server/link-preview'
import { fartPhrase, sharedView } from './shared'

export const dynamic = 'force-dynamic'
export const alt = 'A fart on Farty'
export const size = LINK_IMAGE_SIZE
export const contentType = 'image/png'

const inTheBundledFont = (note: string) => note.replace('♯', '#')

export default async function Image({
  params
}: {
  params: Promise<{ handle: string; id: string }>
}) {
  const { handle, id } = await params
  const view = await sharedView(handle, id)
  if (!view) return linkImageNotFound()
  return linkImage({
    name: view.name,
    byline: `${fartPhrase(null)} by @${view.handle}`,
    pill: view.note === null ? null : inTheBundledFont(view.note),
    levels: view.levels,
    bars: 40
  })
}
