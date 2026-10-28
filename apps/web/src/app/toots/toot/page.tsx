import type { Metadata } from 'next'
import { Suspense } from 'react'
import { TootScreen } from '@/components/pedos/toot-screen'

export const metadata: Metadata = { title: 'Toot · Farty' }

export default function TootPage() {
  return (
    <Suspense>
      <TootScreen />
    </Suspense>
  )
}
