import type { Metadata } from 'next'
import { Suspense } from 'react'
import { TootScreen } from '@/components/pedos/toot-screen'

export const metadata: Metadata = { title: 'Toot · Pedos' }

// One static page for every Toot (`?id=`): a Toot is made on the device, so there's no page per
// Toot to build, and the service worker keeps this one for offline use (`/shell.json`).
export default function TootPage() {
  return (
    <Suspense>
      <TootScreen />
    </Suspense>
  )
}
