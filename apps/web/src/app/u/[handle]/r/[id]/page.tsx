import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { SharedRecordingPage } from '@/components/pedos/shared-recording-page'
import { siteOrigin } from '@/lib/site'
import { fartPhrase, sharedView } from './shared'

// A shared Recording's page (ADR 0020): public, unlisted, and read from D1 on every request, so a
// stopped, taken-down or deleted link is gone at once. No `loading.tsx`: a streamed page would
// answer 200 before `notFound()` could make it a 404.
export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params
}: PageProps<'/u/[handle]/r/[id]'>): Promise<Metadata> {
  const { handle, id } = await params
  const view = await sharedView(handle, id)
  // Unlisted: never indexed, and no canonical, which the layout's would give it.
  const unlisted: Metadata = {
    robots: { index: false, follow: false },
    alternates: { canonical: null }
  }
  if (!view) return { ...unlisted, title: 'Link not found · Farty' }
  const title = `${view.name} by @${view.handle}`
  const description = `${fartPhrase(view.note)} on Farty. Tap to play.`
  // Link previews need the image's absolute URL. A local run has no host of its own, so its own.
  const host = (await headers()).get('host')
  const origin = siteOrigin() ?? (host ? `http://${host}` : null)
  return {
    ...unlisted,
    ...(origin ? { metadataBase: new URL(origin) } : {}),
    title: `${title} · Farty`,
    description,
    openGraph: {
      title,
      description,
      url: `/u/${view.handle}/r/${view.shareId}/`,
      siteName: 'Farty',
      type: 'website'
    },
    twitter: { card: 'summary_large_image', title, description }
  }
}

export default async function SharedRecording({ params }: PageProps<'/u/[handle]/r/[id]'>) {
  const { handle, id } = await params
  const view = await sharedView(handle, id)
  if (!view) notFound()
  return <SharedRecordingPage {...view} />
}
