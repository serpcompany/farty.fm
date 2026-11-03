import type { Metadata } from 'next'
import { ProfileScreen } from '@/components/farty/profile-screen'
import { version } from '../../../package.json'

export const metadata: Metadata = { title: 'Profile · Farty' }

export default function ProfilePage() {
  return <ProfileScreen version={version} />
}
