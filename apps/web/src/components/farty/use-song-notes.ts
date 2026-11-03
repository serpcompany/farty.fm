'use client'

import { useCallback, useEffect, useState } from 'react'
import { loadSong } from '@/lib/catalog/load-songs'
import type { Song, SongSummary } from '@/lib/catalog/song'
import { reportError } from '@/lib/telemetry/errors'

type SongNotesState = {
  song: Song | null
  failed: boolean
  retry(): void
}

export function useSongNotes(summary: SongSummary | undefined): SongNotesState {
  const [loaded, setLoaded] = useState<Song | null>(null)
  const [failedPath, setFailedPath] = useState<string | null>(null)
  const notesPath = summary?.notesPath
  const failed = notesPath !== undefined && failedPath === notesPath

  useEffect(() => {
    if (!summary || failed) return
    let left = false
    loadSong(summary).then(
      song => {
        if (!left) setLoaded(song)
      },
      error => {
        reportError('catalog-load-failed', error)
        if (!left) setFailedPath(summary.notesPath)
      }
    )
    return () => {
      left = true
    }
  }, [summary, failed])

  const retry = useCallback(() => setFailedPath(null), [])
  const song = loaded !== null && loaded.notesPath === notesPath ? loaded : null
  return { song, failed: failed && song === null, retry }
}
