'use client'

import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { analyze as analyzeAudio } from '@/lib/analysis/client'
import { upgradeAnalyses } from '@/lib/analysis-upgrade'
import { stopPlayback } from '@/lib/audio/player'
import type { Song } from '@/lib/catalog/song'
import { songs } from '@/lib/catalog/songs.generated'
import { type LibraryChange, onLibraryChanged } from '@/lib/library-sync'
import { nearestNote } from '@/lib/pitch'
import { collectedPitchClasses, coverageKey, type SongRow, songRows } from '@/lib/pitch-coverage'
import * as store from '@/lib/recording-store'
import { type Recording, recordingPitch } from '@/lib/recordings'
import { reportError } from '@/lib/telemetry/errors'
import type { TootDraft } from '@/lib/toot'
import { makeToot as renderToot } from '@/lib/toot-renderer'
import { openVisit } from '@/lib/visit'
import { decodeWav } from '@/lib/wav'
import { waveformLevels } from '@/lib/waveform'
import { usePlayback } from './playback-provider'

type RecordingFields = Parameters<typeof store.saveRecording>[0]

type Recordings = {
  recordings: Recording[] | null
  recording(id: string): Recording | undefined
  melodicRecordings: Recording[]
  collectedNotes: Set<number>
  collectedPitchClasses: Set<number>
  songRows: SongRow[]
  saveRecording(fields: RecordingFields, wav: ArrayBuffer): Promise<Recording>
  analyze(id: string): Promise<Recording | null>
  reanalyze(id: string): Promise<Recording | null> | null
  deleteRecording(id: string): Promise<void>
  importRecordings(files: { id: string; wav: ArrayBuffer }[]): Promise<void>
  makeToot(song: Song, id?: string): Promise<TootDraft>
}

const RecordingsContext = createContext<Recordings | null>(null)

export function useRecordings(): Recordings {
  const recordings = useContext(RecordingsContext)
  if (!recordings) throw new Error('useRecordings needs a RecordingsProvider')
  return recordings
}

function withChange(
  list: Recording[] | null,
  added: Recording[],
  deleted: string[]
): Recording[] | null {
  if (!list) return list
  const kept = list.filter(r => !deleted.includes(r.id))
  const renumbered = new Map(added.map(r => [r.id, r]))
  const merged = kept.map(r => {
    const fresh = renumbered.get(r.id)
    return fresh ? { ...r, number: fresh.number } : r
  })
  const ids = new Set(kept.map(r => r.id))
  return [...merged, ...added.filter(r => !ids.has(r.id))].sort((a, b) => a.number - b.number)
}

function useSongRows(recordings: readonly Recording[]): SongRow[] {
  const key = coverageKey(recordings)
  const [matched, setMatched] = useState(() => ({ key, rows: songRows(songs, recordings) }))
  if (matched.key === key) return matched.rows
  const rematched = { key, rows: songRows(songs, recordings) }
  setMatched(rematched)
  return rematched.rows
}

function useLibraryRecordings(
  setRecordings: Dispatch<SetStateAction<Recording[] | null>>,
  replace: (updated: Recording) => void,
  analyze: (id: string) => Promise<Recording | null>
): void {
  const { stopPlaying } = usePlayback()

  useEffect(() => {
    openVisit()
      .library.then(store.loadRecordings)
      .then(loaded => {
        setRecordings(loaded)
        for (const recording of loaded) {
          if (recording.analysis.state === 'analyzing') void analyze(recording.id)
        }
        void upgradeAnalyses(loaded, analyzeAudio, replace)
      })
  }, [setRecordings, replace, analyze])

  useEffect(
    () =>
      onLibraryChanged((change: LibraryChange) => {
        if (change.reset) {
          stopPlayback()
          void store.loadRecordings().then(
            loaded => {
              setRecordings(loaded)
              void upgradeAnalyses(loaded, analyzeAudio, replace)
            },
            error => reportError('library-reload-failed', error)
          )
          return
        }
        for (const id of change.deleted.recordings) stopPlaying(id)
        void upgradeAnalyses(change.recordings, analyzeAudio, replace)
        setRecordings(list => withChange(list, change.recordings, change.deleted.recordings))
      }),
    [setRecordings, replace, stopPlaying]
  )
}

export function RecordingsProvider({ children }: { children: ReactNode }) {
  const [recordings, setRecordings] = useState<Recording[] | null>(null)
  const latest = useRef<Recording[] | null>(null)
  useEffect(() => {
    latest.current = recordings
  }, [recordings])

  const replace = useCallback((updated: Recording) => {
    setRecordings(list => list?.map(r => (r.id === updated.id ? updated : r)) ?? null)
  }, [])

  const keep = useCallback((saved: Recording) => {
    setRecordings(list => [...(list ?? []), saved])
  }, [])

  const analyze = useCallback(
    async (id: string): Promise<Recording | null> => {
      try {
        const { samples, sampleRate } = decodeWav(await store.loadAudio(id))
        const analysis = await analyzeAudio({ samples, sampleRate })
        const updated = await store.saveAnalysis(id, { state: 'analyzed', analysis })
        if (!updated) return null
        replace(updated)
        return updated
      } catch (error) {
        reportError('analysis-failed', error)
        const updated = await store.saveAnalysis(id, { state: 'notAnalyzed' })
        if (updated) replace(updated)
        return null
      }
    },
    [replace]
  )

  useLibraryRecordings(setRecordings, replace, analyze)

  const reanalyze = useCallback(
    (id: string) => {
      const recording = latest.current?.find(r => r.id === id)
      if (!recording || recording.analysis.state !== 'notAnalyzed') return null
      replace({ ...recording, analysis: { state: 'analyzing' } })
      return analyze(id)
    },
    [replace, analyze]
  )

  const saveRecording = useCallback(
    async (fields: RecordingFields, wav: ArrayBuffer) => {
      await openVisit().library
      const saved = await store.saveRecording(fields, wav)
      keep(saved)
      return saved
    },
    [keep]
  )

  const deleteRecording = useCallback(async (id: string) => {
    stopPlayback()
    await store.deleteRecording(id)
    setRecordings(list => list?.filter(r => r.id !== id) ?? null)
  }, [])

  const importRecordings = useCallback(
    async (files: { id: string; wav: ArrayBuffer }[]) => {
      const added: Recording[] = []
      try {
        for (const { id, wav } of files) {
          const audio = decodeWav(wav)
          const fields = {
            seconds: audio.samples.length / audio.sampleRate,
            sampleRate: audio.sampleRate,
            waveform: waveformLevels(audio.samples, 40)
          }
          const saved = await store.saveRecording(fields, wav, id)
          added.push(saved)
          keep(saved)
        }
      } finally {
        for (const recording of added) await analyze(recording.id)
      }
    },
    [keep, analyze]
  )

  const makeToot = useCallback(
    (song: Song, id?: string) => renderToot(song, recordings ?? [], store.loadAudio, undefined, id),
    [recordings]
  )

  const melodicRecordings = useMemo(
    () => (recordings ?? []).filter(r => recordingPitch(r) !== null),
    [recordings]
  )
  const collectedNotes = useMemo(
    () =>
      new Set(
        melodicRecordings.flatMap(r => {
          const pitch = recordingPitch(r)
          return pitch === null ? [] : [nearestNote(pitch)]
        })
      ),
    [melodicRecordings]
  )
  const pitchClasses = useMemo(() => collectedPitchClasses(recordings ?? []), [recordings])
  const rows = useSongRows(recordings ?? [])

  const value = useMemo(
    (): Recordings => ({
      recordings,
      recording: id => recordings?.find(r => r.id === id),
      melodicRecordings,
      collectedNotes,
      collectedPitchClasses: pitchClasses,
      songRows: rows,
      saveRecording,
      analyze,
      reanalyze,
      deleteRecording,
      importRecordings,
      makeToot
    }),
    [
      recordings,
      melodicRecordings,
      collectedNotes,
      pitchClasses,
      rows,
      saveRecording,
      analyze,
      reanalyze,
      deleteRecording,
      importRecordings,
      makeToot
    ]
  )
  return <RecordingsContext value={value}>{children}</RecordingsContext>
}
