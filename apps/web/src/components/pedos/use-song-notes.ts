'use client'

import { useCallback, useEffect, useState } from 'react'
import { loadSong } from '@/lib/catalog/load-songs'
import type { Song, SongSummary } from '@/lib/catalog/song'
import { reportError } from '@/lib/telemetry/errors'

/** A Song with its notes, as a screen that plays it loads them. */
export type SongNotesState = {
  /** The Song with its notes, once they've loaded. */
  song: Song | null
  /** The notes didn't load: offline, for a Song never opened before. `retry` tries again. */
  failed: boolean
  retry(): void
}

/**
 * Loads `summary`'s notes (`loadSong`): Song Creator and a Toot's screen play a Song from its
 * notes, which the Song Catalog's index leaves out (#323).
 */
export function useSongNotes(summary: SongSummary | undefined): SongNotesState {
  const [loaded, setLoaded] = useState<Song | null>(null)
  const [failed, setFailed] = useState(false)
  /** Bumped by `retry`, to fetch the notes again. */
  const [attempt, setAttempt] = useState(0)

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is what `retry` changes.
  useEffect(() => {
    setFailed(false)
    if (!summary) return
    let left = false
    loadSong(summary).then(
      song => {
        if (!left) setLoaded(song)
      },
      error => {
        reportError('catalog-load-failed', error)
        if (!left) setFailed(true)
      }
    )
    return () => {
      left = true
    }
  }, [summary, attempt])

  const retry = useCallback(() => setAttempt(n => n + 1), [])
  // Notes loaded for another Song, before this one's, aren't this Song's.
  const song = loaded !== null && loaded.notesPath === summary?.notesPath ? loaded : null
  return { song, failed: failed && song === null, retry }
}
