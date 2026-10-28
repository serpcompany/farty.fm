'use client'

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { forgetDecoded, stopPlayback } from '@/lib/audio/player'
import { songs } from '@/lib/catalog/songs.generated'
import { onLibraryChanged } from '@/lib/library-sync'
import { reportError } from '@/lib/telemetry/errors'
import { noteSeconds, type Toot, type TootDraft } from '@/lib/toot'
import * as tootStore from '@/lib/toot-store'
import { openVisit } from '@/lib/visit'
import { usePlayback } from './playback-provider'

type Toots = {
  toots: Toot[] | null
  tootsFailed: boolean
  toot(id: string): Toot | undefined
  saveToot(draft: TootDraft): Promise<void>
  toggleTootPlayback(toot: TootDraft | Toot, note?: number): void
  tootPlayFailed: string | null
  renameToot(id: string, title: string): void
  deleteToot(id: string): void
  forgetToot(id: string): void
}

const TootsContext = createContext<Toots | null>(null)

export function useToots(): Toots {
  const toots = useContext(TootsContext)
  if (!toots) throw new Error('useToots needs a TootsProvider')
  return toots
}

export function tootPlayback(tootId: string, note?: number): string {
  return note === undefined ? `toot:${tootId}` : `toot:${tootId}:note:${note}`
}

const decodeKey = (tootId: string) => `toot-${tootId}`

function withChange(list: Toot[] | null, changed: Toot[], deleted: string[]): Toot[] | null {
  if (!list) return list
  const kept = list.filter(t => !deleted.includes(t.id))
  const renamed = new Map(changed.map(t => [t.id, t]))
  const merged = kept.map(t => {
    const fresh = renamed.get(t.id)
    return fresh ? { ...t, title: fresh.title } : t
  })
  const ids = new Set(kept.map(t => t.id))
  return [...merged, ...changed.filter(t => !ids.has(t.id))].sort(
    (a, b) => b.createdAt - a.createdAt
  )
}

function savedFirst(current: Toot[] | null, saved: Toot[]): Toot[] {
  return [...(current ?? []).filter(toot => !saved.some(s => s.id === toot.id)), ...saved]
}

export function TootsProvider({ children }: { children: ReactNode }) {
  const [toots, setToots] = useState<Toot[] | null>(null)
  const [tootsFailed, setTootsFailed] = useState(false)
  const [tootPlayFailed, setTootPlayFailed] = useState<string | null>(null)
  const savingToots = useRef(new Set<string>())
  const { togglePlayback, stopPlaying } = usePlayback()

  useEffect(() => {
    openVisit()
      .library.then(tootStore.loadToots)
      .then(saved => setToots(current => savedFirst(current, saved)))
      .catch(error => {
        reportError('toots-load-failed', error)
        setTootsFailed(true)
        setToots(current => current ?? [])
      })
  }, [])

  useEffect(
    () =>
      onLibraryChanged(change => {
        if (change.reset) {
          stopPlayback()
          void tootStore
            .loadToots()
            .then(setToots, error => reportError('library-reload-failed', error))
          return
        }
        for (const id of change.deleted.toots) {
          stopPlaying(tootPlayback(id))
          forgetDecoded(decodeKey(id))
        }
        setToots(list => withChange(list, change.toots, change.deleted.toots))
      }),
    [stopPlaying]
  )

  const saveToot = useCallback(
    async (draft: TootDraft) => {
      if (toots?.some(t => t.id === draft.id) || savingToots.current.has(draft.id)) return
      savingToots.current.add(draft.id)
      const toot: Toot = {
        id: draft.id,
        title: draft.song.title,
        songId: draft.song.id,
        createdAt: Date.now(),
        seconds: draft.seconds,
        arrangement: draft.arrangement
      }
      try {
        await tootStore.saveToot(toot, draft.wav)
        setToots(list => [toot, ...(list ?? [])])
      } finally {
        savingToots.current.delete(draft.id)
      }
    },
    [toots]
  )

  const loadSavedAudio = useCallback(
    (id: string) =>
      tootStore.loadTootAudio(id).catch(error => {
        if (error instanceof tootStore.TootAudioMissing) {
          reportError('toot-audio-missing', error)
          setToots(
            list => list?.map(t => (t.id === id ? { ...t, isAudioMissing: true } : t)) ?? null
          )
        } else {
          reportError('toot-audio-read-failed', error)
          setTootPlayFailed(id)
        }
        throw error
      }),
    []
  )

  const toggleTootPlayback = useCallback(
    (toot: TootDraft | Toot, note?: number) => {
      setTootPlayFailed(null)
      const song = 'song' in toot ? toot.song : songs.find(s => s.id === toot.songId)
      if (note !== undefined && !song) return
      const written = note === undefined || !song ? null : noteSeconds(song, song.notes[note])
      togglePlayback({
        key: tootPlayback(toot.id, note),
        decodeKey: decodeKey(toot.id),
        wav: 'wav' in toot ? async () => toot.wav.slice(0) : () => loadSavedAudio(toot.id),
        segment: written && { start: written.start, end: written.start + written.length }
      })
    },
    [togglePlayback, loadSavedAudio]
  )

  const renameToot = useCallback((id: string, title: string) => {
    const trimmed = title.trim()
    if (!trimmed) return
    setToots(list => list?.map(t => (t.id === id ? { ...t, title: trimmed } : t)) ?? null)
    tootStore.renameToot(id, trimmed).catch(error => reportError('toot-rename-failed', error))
  }, [])

  const deleteToot = useCallback(
    (id: string) => {
      stopPlaying(tootPlayback(id))
      setToots(list => list?.filter(t => t.id !== id) ?? null)
      forgetDecoded(decodeKey(id))
      tootStore.deleteToot(id).catch(error => reportError('toot-delete-failed', error))
    },
    [stopPlaying]
  )

  const forgetToot = useCallback((id: string) => {
    forgetDecoded(decodeKey(id))
    setTootPlayFailed(current => (current === id ? null : current))
  }, [])

  const value = useMemo(
    (): Toots => ({
      toots,
      tootsFailed,
      toot: id => toots?.find(t => t.id === id),
      saveToot,
      toggleTootPlayback,
      tootPlayFailed,
      renameToot,
      deleteToot,
      forgetToot
    }),
    [
      toots,
      tootsFailed,
      saveToot,
      toggleTootPlayback,
      tootPlayFailed,
      renameToot,
      deleteToot,
      forgetToot
    ]
  )
  return <TootsContext value={value}>{children}</TootsContext>
}
