import type { Metadata } from 'next'
import { SongCreatorFromAddress } from '@/components/pedos/song-creator'

// The one Song page the service worker keeps (`/shell.json`, #322) in place of every Song's.
// Offline, it answers each Song's page it kept no copy of, `/compose/<song>/`, and shows the Song
// that address names, from the Song Catalog it keeps too. A static segment, so Next serves it
// before `[song]`, and no Song may take the id `song` (`generate.ts`). Not for search engines:
// each Song's own page is.

export const metadata: Metadata = { title: 'Compose · Farty', robots: { index: false } }

export default function SongShellPage() {
  return <SongCreatorFromAddress />
}
