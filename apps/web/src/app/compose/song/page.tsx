import type { Metadata } from 'next'
import { SongCreatorFromAddress } from '@/components/farty/song-creator'

export const metadata: Metadata = { title: 'Compose · Farty', robots: { index: false } }

export default function SongShellPage() {
  return <SongCreatorFromAddress />
}
