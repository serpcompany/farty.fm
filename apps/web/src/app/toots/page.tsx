import type { Metadata } from 'next'
import { TootsScreen } from '@/components/pedos/toots-screen'

export const metadata: Metadata = { title: 'Toots · Farty' }

export default function TootsPage() {
  return <TootsScreen />
}
