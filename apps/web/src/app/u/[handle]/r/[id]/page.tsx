import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SharedRecordingPage } from '@/components/farty/shared-recording-page'
import { linkPreviewMetadata } from '@/server/link-preview'
import { fartPhrase, sharedView } from './shared'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params
}: PageProps<'/u/[handle]/r/[id]'>): Promise<Metadata> {
  const { handle, id } = await params
  const view = await sharedView(handle, id)
  return linkPreviewMetadata(
    view && {
      title: `${view.name} by @${view.handle}`,
      description: `${fartPhrase(view.note)} on Farty. Tap to play.`,
      path: `/u/${view.handle}/r/${view.shareId}/`
    }
  )
}

export default async function SharedRecording({ params }: PageProps<'/u/[handle]/r/[id]'>) {
  const { handle, id } = await params
  const view = await sharedView(handle, id)
  if (!view) notFound()
  return <SharedRecordingPage {...view} />
}
