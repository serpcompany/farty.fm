import type { Metadata } from 'next'
import { ComposeScreen } from '@/components/pedos/compose-screen'

export const metadata: Metadata = { title: 'Compose · Farty' }

export default function ComposePage() {
  return <ComposeScreen />
}
