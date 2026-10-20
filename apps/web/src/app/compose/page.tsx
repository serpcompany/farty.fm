import type { Metadata } from 'next'
import { ComposeScreen } from '@/components/pedos/compose-screen'

export const metadata: Metadata = { title: 'Compose · Pedos' }

export default function ComposePage() {
  return <ComposeScreen />
}
