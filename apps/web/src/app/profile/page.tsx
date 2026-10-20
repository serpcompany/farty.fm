import type { Metadata } from 'next'
import { ProfileScreen } from '@/components/pedos/profile-screen'

export const metadata: Metadata = { title: 'Profile · Pedos' }

export default function ProfilePage() {
  return <ProfileScreen />
}
