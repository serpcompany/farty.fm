import type { Metadata } from 'next'
import { SharedLinkGone } from '@/components/pedos/shared-recording-page'

export const metadata: Metadata = { alternates: { canonical: null } }

/** A shared link that doesn't work: never shared, stopped, taken down, or deleted. A 404. */
export default function SharedLinkNotFound() {
  return <SharedLinkGone />
}
