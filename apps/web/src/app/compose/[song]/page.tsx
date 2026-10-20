import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SongCreator } from '@/components/pedos/song-creator'
import { songs } from '@/lib/catalog/songs.generated'

// Song Creator, one page per Song in the catalog, inside the Compose tab: `/compose/<song>/`.
// Each is prerendered, so the service worker can keep it for offline use (`/shell.json`); any
// other id is not found.

export const dynamicParams = false

export function generateStaticParams() {
  return songs.map(song => ({ song: song.id }))
}

export async function generateMetadata({
  params
}: PageProps<'/compose/[song]'>): Promise<Metadata> {
  const { song: id } = await params
  const song = songs.find(s => s.id === id)
  return { title: song ? `${song.title} · Pedos` : 'Pedos' }
}

export default async function SongCreatorPage({ params }: PageProps<'/compose/[song]'>) {
  const { song: id } = await params
  const song = songs.find(s => s.id === id)
  if (!song) notFound()
  return <SongCreator song={song} />
}
