import type { Metadata } from 'next'
import { ComposeScreen } from '@/components/pedos/compose-screen'
import { SafariAllowNote } from '@/components/pedos/safari-allow-note'

export const metadata: Metadata = { title: 'Compose · Farty' }

export default function ComposePage() {
  return (
    <>
      <ComposeScreen />
      <SafariAllowNote />
    </>
  )
}
