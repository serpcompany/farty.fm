import type { Metadata } from 'next'
import { RecordScreen } from '@/components/pedos/record-screen'
import { siteOrigin } from '@/lib/site'

export const metadata: Metadata = { alternates: { canonical: null } }

const origin = siteOrigin()

export default function RecordPage() {
  return (
    <>
      {origin ? <link rel="canonical" href={origin} /> : null}
      <RecordScreen />
    </>
  )
}
