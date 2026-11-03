import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SharedTootPage } from '@/components/farty/shared-recording-page'
import { linkPreviewMetadata } from '@/server/link-preview'
import { sharedTootView, tootDescription } from './shared'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params
}: PageProps<'/u/[handle]/t/[id]'>): Promise<Metadata> {
  const { handle, id } = await params
  const view = await sharedTootView(handle, id)
  return linkPreviewMetadata(
    view && {
      title: `${view.title} by @${view.handle}`,
      description: tootDescription(view),
      path: `/u/${view.handle}/t/${view.shareId}/`
    }
  )
}

export default async function SharedToot({ params }: PageProps<'/u/[handle]/t/[id]'>) {
  const { handle, id } = await params
  const view = await sharedTootView(handle, id)
  if (!view) notFound()
  return (
    <SharedTootPage
      handle={view.handle}
      shareId={view.shareId}
      title={view.title}
      song={view.song}
      length={view.length}
      seconds={view.seconds}
      levels={view.levels}
    />
  )
}
