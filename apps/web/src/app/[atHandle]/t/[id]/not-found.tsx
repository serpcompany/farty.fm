import type { Metadata } from 'next'
import { SharedLinkGone } from '@/components/pedos/shared-recording-page'

export const metadata: Metadata = { alternates: { canonical: null } }

/** A shared Toot's link that doesn't work: never shared, stopped, taken down, or deleted. A 404. */
export default function SharedTootNotFound() {
  return <SharedLinkGone />
}
