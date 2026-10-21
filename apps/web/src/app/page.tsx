import type { Metadata } from 'next'
import { RecordScreen } from '@/components/pedos/record-screen'
import { siteOrigin } from '@/lib/site'

// The home page's canonical is the bare origin. Next writes `https://farty.fm/` with
// `trailingSlash`, so this page drops the layout's canonical and writes its own.
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
