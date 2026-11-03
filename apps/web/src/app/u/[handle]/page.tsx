import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ProfilePage } from '@/components/farty/profile-page'
import { profileView } from './profile'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: PageProps<'/u/[handle]'>): Promise<Metadata> {
  const { handle } = await params
  const profile = await profileView(handle)
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

export default async function Profile({ params }: PageProps<'/u/[handle]'>) {
  const { handle } = await params
  const profile = await profileView(handle)
  if (!profile) notFound()
  return <ProfilePage {...profile} />
}
