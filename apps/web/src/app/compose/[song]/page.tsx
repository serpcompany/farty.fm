import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SongCreator } from '@/components/farty/song-creator'
import { songs } from '@/lib/catalog/songs.generated'

export const dynamicParams = false

export function generateStaticParams() {
  return songs.map(song => ({ song: song.id }))
}

export async function generateMetadata({
  params
}: PageProps<'/compose/[song]'>): Promise<Metadata> {
  const { song: id } = await params
  const song = songs.find(s => s.id === id)
  return { title: song ? `${song.title} · Farty` : 'Farty' }
}

export default async function SongCreatorPage({ params }: PageProps<'/compose/[song]'>) {
  const { song: id } = await params
  const song = songs.find(s => s.id === id)
  if (!song) notFound()
  return <SongCreator song={song} />
}
