import type { Metadata } from 'next'
import { SharedLinkGone } from '@/components/pedos/shared-recording-page'

export const metadata: Metadata = { alternates: { canonical: null } }

/** A profile page no one has: a Handle never picked, or its account deleted. A 404. */
export default function ProfileNotFound() {
  return <SharedLinkGone />
}
