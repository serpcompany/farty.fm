import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import { linkParams, withQuery } from '@/app/[atHandle]/link-params'
import { SharedRecordingPage } from '@/components/pedos/shared-recording-page'
import { linkPreviewMetadata } from '@/server/link-preview'
import { sharePath } from '@/server/sharing'
import { fartPhrase, sharedView } from './shared'

// A shared Recording's page (ADR 0020), at `/@<handle>/r/<id>/` (#382): public, unlisted, and
// read from D1 on every request, so a stopped, taken-down or deleted link is gone at once. No
// `loading.tsx`: a streamed page would answer 200 before `notFound()` could make it a 404.
export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params
}: PageProps<'/[atHandle]/r/[id]'>): Promise<Metadata> {
  const { handle, id } = await linkParams(params)
  // A path with no `@` is the site's 404, with that page's one robots tag.
  if (!handle) return {}
  const view = await sharedView(handle, id)
  return linkPreviewMetadata(
    view && {
      title: `${view.name} by @${view.handle}`,
      description: `${fartPhrase(view.note)} on Farty. Tap to play.`,
      path: sharePath('recordings', view.handle, view.slug),
      imageAlt: 'A fart on Farty'
    }
  )
}

export default async function SharedRecording({
  params,
  searchParams
}: PageProps<'/[atHandle]/r/[id]'>) {
  const { handle, id } = await linkParams(params)
  const view = await sharedView(handle, id)
  if (!view) notFound()
  // A link from before #441, by its random id, keeps working, and a name in capitals finds it.
  if (view.slug !== id) {
    permanentRedirect(
      await withQuery(sharePath('recordings', view.handle, view.slug), searchParams)
    )
  }
  return <SharedRecordingPage {...view} />
}
