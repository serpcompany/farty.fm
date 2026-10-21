import type { Metadata } from 'next'
import { RecordingsScreen } from '@/components/pedos/recordings-screen'

export const metadata: Metadata = { title: 'Recordings · Farty' }

export default function RecordingsPage() {
  return <RecordingsScreen />
}
