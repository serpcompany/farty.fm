'use client'

import { usePathname } from 'next/navigation'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react'
import { preload } from 'react-dom'
import { catalogPath } from '@/lib/catalog/catalog-path.generated'
import { loadSongs } from '@/lib/catalog/load-songs'
import type { SongSummary } from '@/lib/catalog/song'
import { reportError } from '@/lib/telemetry/errors'

type SongCatalog = {
  songs: readonly SongSummary[] | null
  songsFailed: boolean
  reloadSongs(): void
  song(id: string): SongSummary | undefined
}

const SongCatalogContext = createContext<SongCatalog | null>(null)

export function useSongCatalog(): SongCatalog {
  const catalog = useContext(SongCatalogContext)
  if (!catalog) throw new Error('useSongCatalog needs a SongCatalogProvider')
  return catalog
}

export function SongCatalogProvider({ children }: { children: ReactNode }) {
  const wanted = !usePathname()?.startsWith('/u/')
  if (wanted) preload(catalogPath, { as: 'fetch', crossOrigin: 'anonymous' })
  const [songs, setSongs] = useState<readonly SongSummary[] | null>(null)
  const [songsFailed, setSongsFailed] = useState(false)

  const reloadSongs = useCallback(() => {
    setSongsFailed(false)
    loadSongs().then(
      loaded => {
        setSongs(loaded)
        setSongsFailed(false)
      },
      error => {
        reportError('catalog-load-failed', error)
        setSongsFailed(true)
      }
    )
  }, [])

  useEffect(() => {
    if (wanted) reloadSongs()
  }, [wanted, reloadSongs])

  useEffect(() => {
    if (!songsFailed) return
    window.addEventListener('online', reloadSongs)
    return () => window.removeEventListener('online', reloadSongs)
  }, [songsFailed, reloadSongs])

  const value = useMemo((): SongCatalog => {
    const byId = new Map(songs?.map(song => [song.id, song]))
    return { songs, songsFailed, reloadSongs, song: id => byId.get(id) }
  }, [songs, songsFailed, reloadSongs])
  return <SongCatalogContext value={value}>{children}</SongCatalogContext>
}
