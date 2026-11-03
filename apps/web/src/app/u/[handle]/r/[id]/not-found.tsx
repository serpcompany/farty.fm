import type { Metadata } from 'next'
import { SharedLinkGone } from '@/components/farty/shared-recording-page'

export const metadata: Metadata = { alternates: { canonical: null } }

export default function SharedLinkNotFound() {
  return <SharedLinkGone />
}
