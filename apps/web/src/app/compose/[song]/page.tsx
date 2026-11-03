import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SongCreator } from '@/components/pedos/song-creator'
import { songIndex } from '@/lib/catalog/song-index.generated'

// Song Creator, one page per Song in the catalog, inside the Compose tab: `/compose/<song>/`.
// Each is prerendered with its Song's title and source line, so a link or a search engine opens it
// on its own; any other id is not found. The notes come from the Song Catalog the browser fetches
// (#322), so the page holds only which Song it is. Offline, the service worker answers a Song's
// page it kept no copy of with `/compose/song/`, which reads the Song from the address.

export const dynamicParams = false

export function generateStaticParams() {
  return songIndex.map(song => ({ song: song.id }))
}

export async function generateMetadata({
  params
}: PageProps<'/compose/[song]'>): Promise<Metadata> {
  const { song: id } = await params
  const song = songIndex.find(s => s.id === id)
  return { title: song ? `${song.title} · Farty` : 'Farty' }
}

export default async function SongCreatorPage({ params }: PageProps<'/compose/[song]'>) {
  const { song: id } = await params
  const song = songIndex.find(s => s.id === id)
  if (!song) notFound()
  const { title, source } = song
  return <SongCreator id={id} heading={{ id, title, source }} />
}
