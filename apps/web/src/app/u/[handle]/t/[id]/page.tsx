import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SharedTootPage } from '@/components/pedos/shared-recording-page'
import { linkPreviewMetadata } from '@/server/link-preview'
import { sharedTootView, tootDescription } from './shared'

// A shared Toot's page (ADR 0020), as a shared Recording's: public, unlisted, and read from D1 on
// every request, so a stopped, taken-down or deleted link is gone at once. No `loading.tsx`: a
// streamed page would answer 200 before `notFound()` could make it a 404.
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
