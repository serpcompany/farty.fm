import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { linkParams } from '@/app/[atHandle]/link-params'
import { ProfilePage } from '@/components/pedos/profile-page'
import { profileView } from './profile'

// A profile page (#319, ADR 0021), at `/@<handle>/` (#382): public, and read from D1 on every
// request, so it lists only what its user shares right now. No `loading.tsx`: a streamed page
// would answer 200 before `notFound()` could make it a 404.
export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: PageProps<'/[atHandle]'>): Promise<Metadata> {
  const { handle } = await linkParams(params)
  // A path with no `@` is the site's 404, with that page's one robots tag.
  if (!handle) return {}
  const profile = await profileView(handle)
  // As a shared link's: never indexed, and no canonical, which the layout's would give it.
  const unlisted: Metadata = {
    robots: { index: false, follow: false },
    alternates: { canonical: null }
  }
  if (!profile) return { ...unlisted, title: 'Link not found · Farty' }
  return {
    ...unlisted,
    title: `@${profile.handle} · Farty`,
    description: `What @${profile.handle} shared on Farty.`
  }
}

export default async function Profile({ params }: PageProps<'/[atHandle]'>) {
  const { handle } = await linkParams(params)
  const profile = await profileView(handle)
  if (!profile) notFound()
  return <ProfilePage {...profile} />
}
