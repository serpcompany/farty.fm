import type { Metadata } from 'next'
import { TootsScreen } from '@/components/pedos/toots-screen'

export const metadata: Metadata = { title: 'Toots · Pedos' }

export default function TootsPage() {
  return <TootsScreen />
}
