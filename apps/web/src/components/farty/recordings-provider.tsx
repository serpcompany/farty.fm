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
import { analyze as analyzeAudio, findTrim } from '@/lib/analysis/client'
import type { RescanResult } from '@/lib/analysis-upgrade'
import { upgradeAnalyses } from '@/lib/analysis-upgrade'
import { stopPlayback } from '@/lib/audio/player'
import type { Song, SongSummary } from '@/lib/catalog/song'
import { type LibraryChange, onLibraryChanged, recordingsAfter } from '@/lib/library-changes'
import type { Performance } from '@/lib/performance'
import { nearestNote } from '@/lib/pitch'
import {
  type Coverage,
  collectedPitchClasses,
  coverageKey,
  coverageOf,
  type SongRow,
  songRows
} from '@/lib/pitch-coverage'
import * as store from '@/lib/recording-store'
import {
  type AnalysisState,
  type Recording,
  type RecordingTrim,
  songPitch,
  type Trim
} from '@/lib/recordings'
import type { ReviewChange } from '@/lib/take-review'
import { reportError } from '@/lib/telemetry/errors'
import type { PadTootDraft, SongTootDraft } from '@/lib/toot'
import { makePadToot as renderPadToot, makeToot as renderToot } from '@/lib/toot-renderer'
import { openVisit } from '@/lib/visit'
import { decodeWav } from '@/lib/wav'
import { waveformLevels } from '@/lib/waveform'
import { usePlayback } from './playback-provider'
import { useSongCatalog } from './song-catalog-provider'
import { type Rescanning, useRescan } from './use-rescan'

type RecordingFields = Parameters<typeof store.saveRecording>[0]

export type LibraryProblem = 'newer' | 'unreadable'

type Recordings = {
  recordings: Recording[] | null
  libraryProblem: LibraryProblem | null
  recording(id: string): Recording | undefined
  melodicRecordings: Recording[]
  collectedNotes: Set<number>
  collectedPitchClasses: Set<number>
  songRows: SongRow[]
  coverage(song: SongSummary): Coverage
  saveRecording(fields: RecordingFields, wav: ArrayBuffer): Promise<Recording>
  analyze(id: string): Promise<Recording | null>
  keepAnalysis(id: string, state: AnalysisState): Promise<Recording | null>
  reanalyze(id: string): Promise<Recording | null> | null
  deleteRecording(id: string): Promise<void>
  placeRecording(id: string, change: ReviewChange): Promise<boolean>
  rescanning: Rescanning | null
  rescanned: RescanResult | null
  rescanRecording(id: string): Promise<RescanResult>
  rescanAll(): Promise<RescanResult>
  importRecordings(files: { id: string; wav: ArrayBuffer }[]): Promise<void>
  makeToot(song: Song, id?: string): Promise<SongTootDraft>
  makePadToot(performance: Performance, id?: string): Promise<PadTootDraft>
}

const RecordingsContext = createContext<Recordings | null>(null)

export function useRecordings(): Recordings {
  const recordings = useContext(RecordingsContext)
  if (!recordings) throw new Error('useRecordings needs a RecordingsProvider')
  return recordings
}

type Coverages = {
  key: string
  songs: readonly SongSummary[] | null
  rows: SongRow[]
  coverage(song: SongSummary): Coverage
}

function coverages(
  key: string,
  songs: readonly SongSummary[] | null,
  recordings: readonly Recording[]
): Coverages {
  const arranged = new Map<SongSummary, Coverage>()
  return {
    key,
    songs,
    rows: songRows(songs ?? [], recordings),
    coverage(song) {
      let found = arranged.get(song)
      if (!found) {
        found = coverageOf(song, recordings)
        arranged.set(song, found)
      }
      return found
    }
  }
}

function useCoverages(recordings: readonly Recording[]): Coverages {
  const { songs } = useSongCatalog()
  const key = coverageKey(recordings)
  const [matched, setMatched] = useState(() => coverages(key, songs, recordings))
  if (matched.key === key && matched.songs === songs) return matched
  const rematched = coverages(key, songs, recordings)
  setMatched(rematched)
  return rematched
}

async function trimBetween(id: string, handles: Trim): Promise<RecordingTrim> {
  const fart = await findTrim(decodeWav(await store.loadAudio(id)), handles)
  return { startSeconds: handles.startSeconds, endSeconds: handles.endSeconds, fart }
}

async function placement(
  id: string,
  { placedPitch, handles, name }: ReviewChange
): Promise<store.Placement> {
  const change: store.Placement = {}
  if (placedPitch !== undefined) change.placedPitch = placedPitch
  if (name !== undefined) change.name = name
  if (handles !== undefined) change.trim = handles && (await trimBetween(id, handles))
  return change
}

function useLibraryRecordings(
  setRecordings: Dispatch<SetStateAction<Recording[] | null>>,
  replace: (updated: Recording) => void,
  analyze: (id: string) => Promise<Recording | null>,
  setLibraryProblem: (problem: LibraryProblem) => void
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
      .catch(error => {
        reportError('library-open-failed', error)
        setLibraryProblem(store.savedByANewerFarty(error) ? 'newer' : 'unreadable')
      })
  }, [setRecordings, replace, analyze, setLibraryProblem])

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
        setRecordings(list => list && recordingsAfter(list, change))
      }),
    [setRecordings, replace, stopPlaying]
  )
}

export function RecordingsProvider({ children }: { children: ReactNode }) {
  const [recordings, setRecordings] = useState<Recording[] | null>(null)
  const [libraryProblem, setLibraryProblem] = useState<LibraryProblem | null>(null)
  const latest = useRef<Recording[] | null>(null)
  useEffect(() => {
    latest.current = recordings
  }, [recordings])

  const replace = useCallback((updated: Recording) => {
    setRecordings(
      list =>
        list?.map(r => (r.id === updated.id ? { ...r, analysis: updated.analysis } : r)) ?? null
    )
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

  useLibraryRecordings(setRecordings, replace, analyze, setLibraryProblem)
  const { rescanning, rescanned, rescanRecording, rescanAll } = useRescan(latest, replace)

  const keepAnalysis = useCallback(
    async (id: string, state: AnalysisState) => {
      const kept = await store.saveAnalysis(id, state).catch(error => {
        reportError('analysis-failed', error)
        return null
      })
      if (kept) replace(kept)
      return kept
    },
    [replace]
  )

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

  const placeRecording = useCallback(async (id: string, review: ReviewChange) => {
    let change: store.Placement
    try {
      change = await placement(id, review)
    } catch (error) {
      reportError('recording-trim-failed', error)
      return false
    }
    if (Object.keys(change).length === 0) return true
    setRecordings(list => list?.map(r => (r.id === id ? { ...r, ...change } : r)) ?? null)
    await store
      .placeRecording(id, change)
      .catch(error => reportError('recording-place-failed', error))
    return true
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

  const makePadToot = useCallback(
    (performance: Performance, id?: string) =>
      renderPadToot(performance, recordings ?? [], store.loadAudio, undefined, id),
    [recordings]
  )

  const melodicRecordings = useMemo(
    () => (recordings ?? []).filter(r => songPitch(r) !== null),
    [recordings]
  )
  const collectedNotes = useMemo(
    () =>
      new Set(
        melodicRecordings.flatMap(r => {
          const pitch = songPitch(r)
          return pitch === null ? [] : [nearestNote(pitch)]
        })
      ),
    [melodicRecordings]
  )
  const pitchClasses = useMemo(() => collectedPitchClasses(recordings ?? []), [recordings])
  const { rows, coverage } = useCoverages(recordings ?? [])

  const value = useMemo(
    (): Recordings => ({
      recordings,
      libraryProblem,
      recording: id => recordings?.find(r => r.id === id),
      melodicRecordings,
      collectedNotes,
      collectedPitchClasses: pitchClasses,
      songRows: rows,
      coverage,
      saveRecording,
      analyze,
      keepAnalysis,
      reanalyze,
      deleteRecording,
      placeRecording,
      rescanning,
      rescanned,
      rescanRecording,
      rescanAll,
      importRecordings,
      makeToot,
      makePadToot
    }),
    [
      recordings,
      libraryProblem,
      melodicRecordings,
      collectedNotes,
      pitchClasses,
      rows,
      coverage,
      saveRecording,
      analyze,
      keepAnalysis,
      reanalyze,
      deleteRecording,
      placeRecording,
      rescanning,
      rescanned,
      rescanRecording,
      rescanAll,
      importRecordings,
      makeToot,
      makePadToot
    ]
  )
  return <RecordingsContext value={value}>{children}</RecordingsContext>
}
