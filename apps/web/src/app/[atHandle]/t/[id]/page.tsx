import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import { linkParams } from '@/app/[atHandle]/link-params'
import { SharedTootPage } from '@/components/pedos/shared-recording-page'
import { linkPreviewMetadata } from '@/server/link-preview'
import { sharePath } from '@/server/sharing'
import { sharedTootView, tootDescription } from './shared'

// A shared Toot's page (ADR 0020), at `/@<handle>/t/<id>/` (#382), as a shared Recording's:
// public, unlisted, and read from D1 on every request, so a stopped, taken-down or deleted link is
// gone at once. No `loading.tsx`: a streamed page would answer 200 before `notFound()` could make
// it a 404.
export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params
}: PageProps<'/[atHandle]/t/[id]'>): Promise<Metadata> {
  const { handle, id } = await linkParams(params)
  // A path with no `@` is the site's 404, with that page's one robots tag.
  if (!handle) return {}
  const view = await sharedTootView(handle, id)
  return linkPreviewMetadata(
    view && {
      title: `${view.title} by @${view.handle}`,
      description: tootDescription(view),
      path: sharePath('toots', view.handle, view.slug),
      imageAlt: 'A fart song on Farty'
    }
  )
}

export default async function SharedToot({ params }: PageProps<'/[atHandle]/t/[id]'>) {
  const { handle, id } = await linkParams(params)
  const view = await sharedTootView(handle, id)
  if (!view) notFound()
  // A link from before #441, by its random id, keeps working.
  if (view.slug !== id) permanentRedirect(sharePath('toots', view.handle, view.slug))
  return (
    <SharedTootPage
      handle={view.handle}
      slug={view.slug}
      title={view.title}
      song={view.song}
      length={view.length}
      seconds={view.seconds}
      levels={view.levels}
    />
  )
}
