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
import { analyze } from '@/lib/analysis/client'
import { type RescanResult, rescan, upgradeAnalyses } from '@/lib/analysis-upgrade'
import { forgetDecoded, play, stopPlayback } from '@/lib/audio/player'
import {
  MicrophoneDeniedError,
  MicrophoneReleasedError,
  startTake,
  type Take
} from '@/lib/audio/recorder'
import type { Song } from '@/lib/catalog/song'
import { songs } from '@/lib/catalog/songs.generated'
import { onLibraryChanged, recordingsAfter } from '@/lib/library-sync'
import type { Performance } from '@/lib/performance'
import { nearestNote } from '@/lib/pitch'
import {
  type CoverageChanges,
  collectedPitchClasses,
  coverageChanges,
  coverageKey,
  type SongRow,
  songRows
} from '@/lib/pitch-coverage'
import * as store from '@/lib/recording-store'
import {
  atFullLevel,
  heardSomething,
  maximumTakeSeconds,
  type Recording,
  songPitch,
  TakeLevels
} from '@/lib/recordings'
import { holdReload } from '@/lib/stale-build'
import { reportError } from '@/lib/telemetry/errors'
import {
  noteSeconds,
  PAD_TOOT_TITLE,
  type PadTootDraft,
  type SongTootDraft,
  type Toot,
  type TootDraft
} from '@/lib/toot'
import { makePadToot as renderPadToot, makeToot as renderToot } from '@/lib/toot-renderer'
import * as tootStore from '@/lib/toot-store'
import { openVisit } from '@/lib/visit'
import { decodeWav, encodeWav, type PcmAudio } from '@/lib/wav'
import { waveformLevels } from '@/lib/waveform'
import { welcomedKey } from '@/lib/welcomed'

/** A just-recorded take that hasn't been saved or discarded yet. */
export type Draft = { audio: PcmAudio; seconds: number; waveform: number[] }

/**
 * Record's states (#281): getting the microphone ready, recording once its audio comes in, and
 * finishing the take after Stop. `hearsNothing`: about 2 s in, the take so far is one
 * `heardSomething` would refuse, so Record says it can't hear anything. The take goes on.
 */
export type Capture =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'recording'; startedAt: number; hearsNothing: boolean }
  | { kind: 'finishing'; startedAt: number; stoppedAt: number }

/** How long a take records before Record says it can't hear anything, if it can't. */
export const hintAfterMs = 2000

/**
 * Record's live level, 0…1, from the take's batches (`TakeLevels.level`). It's kept outside React
 * state, so only the level redraws with each batch: `useSyncExternalStore(subscribe, current)`.
 */
export type InputLevel = {
  current(): number
  subscribe(listener: () => void): () => void
}

function inputLevelStore(): InputLevel & { set(level: number): void } {
  let level = 0
  const listeners = new Set<() => void>()
  return {
    current: () => level,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(next) {
      if (next === level) return
      level = next
      for (const listener of listeners) listener()
    }
  }
}

/** The take being recorded, with its timers: the 30 s limit and the hint's 2 s. */
type TakeInProgress = { take: Take; startedAt: number; limit: number; hint: number }

/** Clears the take's timers and its level, as it stops or is lost. */
function letGo(current: TakeInProgress, inputLevel: { set(level: number): void }): void {
  clearTimeout(current.limit)
  clearTimeout(current.hint)
  inputLevel.set(0)
}

/** The full-screen record flow after Stop: Review, then Result, with their error states. */
export type Flow =
  | { kind: 'review'; draft: Draft }
  | { kind: 'saveFailed'; draft: Draft }
  | { kind: 'analyzing'; id: string }
  | { kind: 'analysisFailed'; id: string }
  | { kind: 'result'; id: string; changes: CoverageChanges }

export type RecordProblem = 'microphoneOff' | 'couldNotStart' | 'interrupted' | 'nothingHeard'

/**
 * What's playing: the draft on Review, a saved Recording by id, or a Toot or one of its notes
 * (`tootPlayback`).
 */
export type NowPlaying = 'draft' | string | null

/** What `nowPlaying` holds while a Toot plays, or just its `note`th note. */
export function tootPlayback(tootId: string, note?: number): string {
  return note === undefined ? `toot:${tootId}` : `toot:${tootId}:note:${note}`
}

/** Where a Re-scan is: the Recording it is on, after `done` of `total`. */
export type Rescanning = { recordingId: string; done: number; total: number }

/**
 * What Profile counts, from what's in this browser. As the iPhone app's `ProfileStats`; unlocked
 * Songs follow Compose's Pitch Coverage.
 */
export type ProfileStats = {
  recordings: number
  melodicRecordings: number
  /** The distinct notes the Melodic Recordings sound, octave included, as on Recordings. */
  notesCollected: number
  unlockedSongs: number
  /** Every Song in the Song Catalog this build ships. */
  songs: number
  toots: number
}

type Pedos = {
  recordings: Recording[] | null
  recording(id: string): Recording | undefined
  /**
   * The Recordings Songs can use on a note: those with a Recording Pitch, and those placed by ear
   * (ADR 0015).
   */
  melodicRecordings: Recording[]
  /** The notes of every Melodic Recording, octave included (G3, G♯3 and G4 are three notes). */
  collectedNotes: Set<number>
  /** The pitch classes (0 = C … 11 = B) of every Melodic Recording, for the `PitchStrip`. */
  collectedPitchClasses: Set<number>
  /** Every Song with its Pitch Coverage, in catalog order. */
  songRows: SongRow[]
  showsWelcome: boolean
  capture: Capture
  /** The take's live level while recording; 0 otherwise. */
  inputLevel: InputLevel
  flow: Flow | null
  problem: RecordProblem | null
  nowPlaying: NowPlaying
  isSaving: boolean
  /** Recording, Review or Result is on screen, full screen over the tabs. */
  showsRecordFlow: boolean
  finishWelcome(): void
  startRecording(): Promise<void>
  stopRecording(): Promise<void>
  dismissProblem(): void
  saveDraft(): Promise<void>
  discardDraft(): void
  retryAnalysis(id: string): Promise<void>
  finishFlow(): void
  togglePlayback(target: 'draft' | Recording): void
  stopPlayback(): void
  deleteRecording(id: string): Promise<void>
  /**
   * Places a Noise-like Recording on a MIDI note by ear, or takes it off with null (ADR 0015).
   * Every Song uses it there at once; it still plays raw, at its own pitch.
   */
  placeRecording(id: string, placedPitch: number | null): void
  /**
   * The Re-scan running (#282): the Recording it is on, how many came before it, and how many it
   * runs on; null when none runs.
   */
  rescanning: Rescanning | null
  /**
   * What the last Re-scan changed, kept until the next one starts, so a Re-scan that finishes
   * while the Recordings tab is closed still says so there (#295); null before any, and while one
   * runs.
   */
  rescanned: RescanResult | null
  /**
   * Re-scans the Recording if it has no note (`canRescan`): runs the current Recording Analysis on
   * it again. Resolves with what changed. While a Re-scan runs, it waits for that one instead.
   */
  rescanRecording(id: string): Promise<RescanResult>
  /** Re-scans every Recording with no note, one at a time, as `rescanRecording` does one. */
  rescanAll(): Promise<RescanResult>
  /**
   * Adds WAV files as Recordings with these ids, in order, then analyzes each in turn, as a new
   * Recording is: the Fixture Library in an internal build.
   */
  importRecordings(files: { id: string; wav: ArrayBuffer }[]): Promise<void>
  /** Saved Toots, newest first; null until they load. */
  toots: Toot[] | null
  /** The saved Toots didn't load: `toots` is only those saved since. */
  tootsFailed: boolean
  toot(id: string): Toot | undefined
  /**
   * Makes the Toot of an Unlocked Song in the render worker: Song Creator. Throws a `TootError`.
   * `id` is a new one unless given, as when Checkout comes back for the Toot it paid for.
   */
  makeToot(song: Song, id?: string): Promise<SongTootDraft>
  /**
   * Makes the Toot of a Sound Pad Performance in the render worker (ADR 0017). Throws a
   * `TootError`. `id` is a new one unless given, as `makeToot`'s.
   */
  makePadToot(performance: Performance, id?: string): Promise<PadTootDraft>
  /** Keeps a made Toot, once: saving it again does nothing. */
  saveToot(draft: TootDraft): Promise<void>
  /**
   * Plays or stops the whole Toot, or just its `note`th note as rendered: a made Toot from its
   * draft's audio, a saved one from the store. A saved Toot whose audio is gone is marked
   * `isAudioMissing`; one whose audio couldn't be read this time is `tootPlayFailed`.
   */
  toggleTootPlayback(toot: TootDraft | Toot, note?: number): void
  /** The saved Toot whose audio couldn't be read on its last play, until the next play. */
  tootPlayFailed: string | null
  /** Gives a Toot a new title, trimmed. An empty title changes nothing. */
  renameToot(id: string, title: string): void
  /** Deletes a Toot and its audio, and stops it if it's playing. */
  deleteToot(id: string): void
  /** Lets go of a Toot's decoded audio, and its failed play, when its screen closes. */
  forgetToot(id: string): void
  /** When what's playing started (`performance.now()`), once it has; null otherwise. */
  playbackStartedAt: number | null
  /** The database waits for Farty in another tab, on an older version, to close. */
  waitsForOtherTabs: boolean
  /** Profile's counts; null until the Recordings and Toots load. */
  profileStats: ProfileStats | null
}

const PedosContext = createContext<Pedos | null>(null)

export function usePedos(): Pedos {
  const pedos = useContext(PedosContext)
  if (!pedos) throw new Error('usePedos needs a PedosProvider')
  return pedos
}

/** The app's state and actions, mirroring the iPhone app's `AppModel`. */
export function PedosProvider({ children }: { children: ReactNode }) {
  const [recordings, setRecordings] = useState<Recording[] | null>(null)
  const [showsWelcome, setShowsWelcome] = useState(false)
  const [capture, setCapture] = useState<Capture>({ kind: 'idle' })
  const [flow, setFlow] = useState<Flow | null>(null)
  const [problem, setProblem] = useState<RecordProblem | null>(null)
  const [nowPlaying, setNowPlaying] = useState<NowPlaying>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [toots, setToots] = useState<Toot[] | null>(null)
  const [tootsFailed, setTootsFailed] = useState(false)
  const [tootPlayFailed, setTootPlayFailed] = useState<string | null>(null)
  const [playbackStart, setPlaybackStart] = useState<{ key: string; at: number } | null>(null)
  const [waitsForOtherTabs, setWaitsForOtherTabs] = useState(false)
  const [rescanning, setRescanning] = useState<Rescanning | null>(null)
  const [rescanned, setRescanned] = useState<RescanResult | null>(null)
  const running = useRef<Promise<RescanResult> | null>(null)
  const savingToots = useRef(new Set<string>())
  /** Counts Toot plays, so only the latest one sets where the playhead starts. */
  const tootPlays = useRef(0)
  const take = useRef<TakeInProgress | null>(null)
  const [inputLevel] = useState(inputLevelStore)
  // The Recordings as last rendered, to compare Pitch Coverage after an analysis.
  const latest = useRef<Recording[] | null>(null)
  useEffect(() => {
    latest.current = recordings
  }, [recordings])

  const replace = useCallback((updated: Recording) => {
    setRecordings(list => list?.map(r => (r.id === updated.id ? updated : r)) ?? null)
  }, [])

  /** Analyzes a saved Recording: the analyzed Recording, or null when analysis failed. */
  const runAnalysis = useCallback(
    async (id: string): Promise<Recording | null> => {
      try {
        const { samples, sampleRate } = decodeWav(await store.loadAudio(id))
        const analysis = await analyze({ samples, sampleRate })
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

  /**
   * The Result screen after analysis, with what the Recording changed in the Song Catalog's Pitch
   * Coverage: the iPhone app's `analyze()` compares the Recordings before and after it.
   */
  const resultOf = useCallback((analyzed: Recording): Flow => {
    const others = (latest.current ?? []).filter(r => r.id !== analyzed.id)
    return {
      kind: 'result',
      id: analyzed.id,
      changes: coverageChanges(songs, others, [...others, analyzed])
    }
  }, [])

  useEffect(() => store.onWaitingForOtherTabs(setWaitsForOtherTabs), [])

  useEffect(() => {
    setShowsWelcome(localStorage.getItem(welcomedKey) === null)
    // A guest's new visit first clears the last one's farts (`visit.ts`).
    const library = openVisit().library
    library.then(store.loadRecordings).then(loaded => {
      // An analysis cut off by closing the page starts again, and those an older Recording
      // Analysis made run the current one, one at a time.
      setRecordings(loaded)
      for (const recording of loaded) {
        if (recording.analysis.state === 'analyzing') void runAnalysis(recording.id)
      }
      void upgradeAnalyses(loaded, analyze, replace)
    })
    library
      .then(tootStore.loadToots)
      // A Toot saved before the list loads is newer than any in it, so it stays first.
      .then(saved =>
        setToots(current => [
          ...(current ?? []).filter(toot => !saved.some(s => s.id === toot.id)),
          ...saved
        ])
      )
      .catch(error => {
        reportError('toots-load-failed', error)
        setTootsFailed(true)
        setToots(current => current ?? [])
      })
  }, [runAnalysis, replace])

  // What a sync changes shows at once: Recordings and Toots from the account's other browsers,
  // their renames and deletes (`library-sync.ts`).
  const playing = useRef(nowPlaying)
  useEffect(() => {
    playing.current = nowPlaying
  }, [nowPlaying])
  useEffect(
    () =>
      onLibraryChanged(change => {
        if (change.reset) {
          stopPlayback()
          void store.loadRecordings().then(
            loaded => {
              setRecordings(loaded)
              void upgradeAnalyses(loaded, analyze, replace)
            },
            error => reportError('library-reload-failed', error)
          )
          void tootStore
            .loadToots()
            .then(setToots, error => reportError('library-reload-failed', error))
          return
        }
        const { recordings: added, toots: changed, deleted } = change
        const gone = [...deleted.recordings, ...deleted.toots.map(id => tootPlayback(id))]
        const current = playing.current
        if (current && gone.some(key => current === key || current.startsWith(`${key}:`))) {
          stopPlayback()
        }
        for (const id of deleted.toots) forgetDecoded(`toot-${id}`)
        // The account keeps the analysis each Recording was uploaded with, maybe an older one.
        void upgradeAnalyses(added, analyze, replace)
        setRecordings(list => list && recordingsAfter(list, change))
        setToots(list => {
          if (!list) return list
          const kept = list.filter(t => !deleted.toots.includes(t.id))
          const fresh = new Map(changed.map(t => [t.id, t]))
          const merged = kept.map(t => {
            const renamed = fresh.get(t.id)
            return renamed ? { ...t, title: renamed.title } : t
          })
          const ids = new Set(kept.map(t => t.id))
          return [...merged, ...changed.filter(t => !ids.has(t.id))].sort(
            (a, b) => b.createdAt - a.createdAt
          )
        })
      }),
    [replace]
  )

  const finishWelcome = useCallback(() => {
    // On a touch tablet this swaps the lander for the app (`lander.tsx`), even where storage is
    // blocked: then only this page load remembers it.
    document.documentElement.setAttribute('data-welcomed', '')
    try {
      localStorage.setItem(welcomedKey, '1')
    } catch {
      // Blocked or full storage: Welcome or the lander shows again on the next load.
    }
    setShowsWelcome(false)
  }, [])

  const stopRecording = useCallback(async () => {
    const current = take.current
    if (!current) return
    take.current = null
    letGo(current, inputLevel)
    setCapture({ kind: 'finishing', startedAt: current.startedAt, stoppedAt: Date.now() })
    const audio = await current.take.stop()
    setCapture({ kind: 'idle' })
    // Judged from the audio, pre-roll included, not from how long the take lasted.
    if (audio.samples.length === 0 || !heardSomething(audio.samples, audio.sampleRate)) {
      setProblem('nothingHeard')
      return
    }
    // Review, the saved file and replay get the take at full level (#279).
    const samples = atFullLevel(audio.samples)
    setFlow({
      kind: 'review',
      draft: {
        audio: { samples, sampleRate: audio.sampleRate },
        seconds: samples.length / audio.sampleRate,
        waveform: waveformLevels(samples, 40)
      }
    })
  }, [inputLevel])

  const startRecording = useCallback(async () => {
    if (capture.kind !== 'idle' || flow) return
    stopPlayback()
    setProblem(null)
    setCapture({ kind: 'starting' })
    try {
      const started = await startTake(
        () => {
          // A call or another app took the microphone: the take is lost.
          if (!take.current) return
          letGo(take.current, inputLevel)
          take.current = null
          setCapture({ kind: 'idle' })
          setProblem('interrupted')
        },
        // The first try stood still and the take tries once more: reported, though not shown.
        error => reportError('mic-start-retried', error)
      )
      // Audio is coming in: this is where Record shows it records.
      const current: TakeInProgress = {
        take: started,
        startedAt: Date.now(),
        limit: window.setTimeout(() => void stopRecording(), maximumTakeSeconds * 1000),
        hint: 0
      }
      take.current = current
      // The level and the hint follow the take's own batches (#281). The hint is the test Stop
      // applies, on the take so far, so the two never disagree.
      const levels = new TakeLevels(started.sampleRate)
      let judging = false
      const judge = () => {
        // A take that has stopped or been lost never judges the one after it.
        if (take.current !== current) return
        const hearsNothing = !levels.heard()
        setCapture(shown =>
          shown.kind === 'recording' && shown.hearsNothing !== hearsNothing
            ? { ...shown, hearsNothing }
            : shown
        )
      }
      started.listen(batch => {
        if (take.current !== current) return
        levels.add(batch)
        inputLevel.set(levels.level)
        if (judging) judge()
      })
      current.hint = window.setTimeout(() => {
        judging = true
        judge()
      }, hintAfterMs)
      setCapture({ kind: 'recording', startedAt: current.startedAt, hearsNothing: false })
    } catch (error) {
      // Something failed after the take started: it stops capturing, rather than running on to
      // its 30 s limit behind the idle screen.
      const lost = take.current
      if (lost) {
        take.current = null
        letGo(lost, inputLevel)
        lost.take.cancel()
      }
      setCapture({ kind: 'idle' })
      // The page was hidden, or widened into the product page, before the microphone opened.
      if (error instanceof MicrophoneReleasedError) return
      const denied = error instanceof MicrophoneDeniedError
      reportError(denied ? 'mic-denied' : 'mic-start-failed', error)
      setProblem(denied ? 'microphoneOff' : 'couldNotStart')
    }
  }, [capture.kind, flow, stopRecording, inputLevel])

  // A new build's reload waits for the take and the record flow after it to close
  // (`stale-build.ts`, #222).
  const recordFlowOpen = capture.kind !== 'idle' || flow !== null
  useEffect(() => (recordFlowOpen ? holdReload() : undefined), [recordFlowOpen])

  const saveDraft = useCallback(async () => {
    if (!flow || (flow.kind !== 'review' && flow.kind !== 'saveFailed') || isSaving) return
    const { draft } = flow
    setIsSaving(true)
    stopPlayback()
    let saved: Recording
    try {
      // Saved after the visit has started, so what its open clears (the last visit's farts, a
      // library an account left, or another account's at sign-in) never takes it.
      await openVisit().library
      saved = await store.saveRecording(
        { seconds: draft.seconds, sampleRate: draft.audio.sampleRate, waveform: draft.waveform },
        encodeWav(draft.audio)
      )
    } catch (error) {
      reportError('recording-save-failed', error)
      setIsSaving(false)
      setFlow({ kind: 'saveFailed', draft })
      return
    }
    setIsSaving(false)
    setRecordings(list => [...(list ?? []), saved])
    setFlow({ kind: 'analyzing', id: saved.id })
    const analyzed = await runAnalysis(saved.id)
    const next: Flow = analyzed ? resultOf(analyzed) : { kind: 'analysisFailed', id: saved.id }
    setFlow(current => (current?.kind === 'analyzing' && current.id === saved.id ? next : current))
  }, [flow, isSaving, runAnalysis, resultOf])

  const discardDraft = useCallback(() => {
    stopPlayback()
    setFlow(null)
  }, [])

  const retryAnalysis = useCallback(
    async (id: string) => {
      const recording = recordings?.find(r => r.id === id)
      if (!recording || recording.analysis.state !== 'notAnalyzed') return
      replace({ ...recording, analysis: { state: 'analyzing' } })
      setFlow(current =>
        current?.kind === 'analysisFailed' && current.id === id
          ? { kind: 'analyzing', id }
          : current
      )
      const analyzed = await runAnalysis(id)
      const next: Flow = analyzed ? resultOf(analyzed) : { kind: 'analysisFailed', id }
      setFlow(current => (current?.kind === 'analyzing' && current.id === id ? next : current))
    },
    [recordings, replace, runAnalysis, resultOf]
  )

  const finishFlow = useCallback(() => {
    stopPlayback()
    setFlow(null)
  }, [])

  const togglePlayback = useCallback(
    (target: 'draft' | Recording) => {
      const key = target === 'draft' ? 'draft' : target.id
      if (nowPlaying === key) {
        stopPlayback()
        return
      }
      const ended = () => setNowPlaying(current => (current === key ? null : current))
      setNowPlaying(key)
      if (target === 'draft') {
        if (flow?.kind !== 'review') return
        const wav = encodeWav(flow.draft.audio)
        // The draft isn't saved yet, so it's decoded fresh each time under a one-off key.
        void play(`draft-${crypto.randomUUID()}`, async () => wav, null, ended)
      } else {
        // The whole take, start to end, as recorded (ADR 0016).
        void play(target.id, () => store.loadAudio(target.id), null, ended)
      }
    },
    [flow, nowPlaying]
  )

  const deleteRecording = useCallback(async (id: string) => {
    stopPlayback()
    await store.deleteRecording(id)
    setRecordings(list => list?.filter(r => r.id !== id) ?? null)
  }, [])

  // As `renameToot`: the list, and so every Song's coverage, changes at once.
  const placeRecording = useCallback((id: string, placedPitch: number | null) => {
    setRecordings(list => list?.map(r => (r.id === id ? { ...r, placedPitch } : r)) ?? null)
    store
      .placeRecording(id, placedPitch)
      .catch(error => reportError('recording-place-failed', error))
  }, [])

  // One Re-scan at a time; a second request waits for the one running.
  const runRescan = useCallback(
    (targets: (all: Recording[]) => Recording[]): Promise<RescanResult> => {
      if (running.current) return running.current
      setRescanned(null)
      const run = rescan(
        targets(latest.current ?? []),
        analyze,
        replace,
        (recording, done, total) => setRescanning({ recordingId: recording.id, done, total })
      )
        .then(result => {
          setRescanned(result)
          return result
        })
        .finally(() => {
          running.current = null
          setRescanning(null)
        })
      running.current = run
      return run
    },
    [replace]
  )
  const rescanRecording = useCallback(
    (id: string) => runRescan(all => all.filter(r => r.id === id)),
    [runRescan]
  )
  const rescanAll = useCallback(() => runRescan(all => all), [runRescan])

  const importRecordings = useCallback(
    async (files: { id: string; wav: ArrayBuffer }[]) => {
      const added: Recording[] = []
      // If a save fails partway, the ones already saved are still analyzed before it throws.
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
          setRecordings(list => [...(list ?? []), saved])
        }
      } finally {
        for (const recording of added) await runAnalysis(recording.id)
      }
    },
    [runAnalysis]
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

  const saveToot = useCallback(
    async (draft: TootDraft) => {
      if (toots?.some(t => t.id === draft.id) || savingToots.current.has(draft.id)) return
      savingToots.current.add(draft.id)
      const saved = { id: draft.id, createdAt: Date.now(), seconds: draft.seconds }
      const toot: Toot =
        draft.song === null
          ? {
              ...saved,
              title: PAD_TOOT_TITLE,
              songId: null,
              arrangement: null,
              performance: draft.performance
            }
          : {
              ...saved,
              title: draft.song.title,
              songId: draft.song.id,
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

  const markAudioMissing = useCallback((id: string) => {
    setToots(list => list?.map(t => (t.id === id ? { ...t, isAudioMissing: true } : t)) ?? null)
  }, [])

  const toggleTootPlayback = useCallback(
    (toot: TootDraft | Toot, note?: number) => {
      const key = tootPlayback(toot.id, note)
      setTootPlayFailed(null)
      if (nowPlaying === key) {
        stopPlayback()
        return
      }
      const song = 'song' in toot ? toot.song : songs.find(s => s.id === toot.songId)
      // A note needs its Song, to find it in the audio.
      if (note !== undefined && !song) return
      const written = note === undefined || !song ? null : noteSeconds(song, song.notes[note])
      const ended = () => setNowPlaying(current => (current === key ? null : current))
      setNowPlaying(key)
      // The playhead waits for this play to start, not an earlier one of the same Toot.
      setPlaybackStart(null)
      tootPlays.current += 1
      const thisPlay = tootPlays.current
      // A note plays as written, from the Toot's own audio: `Song.seconds(of:)` on the iPhone.
      const segment = written && { start: written.start, end: written.start + written.length }
      // The whole Toot and its notes share one decode. Decoding takes the buffer it's given, so a
      // draft's gets a copy, and the draft keeps its audio to save.
      const audio =
        'wav' in toot
          ? async () => toot.wav.slice(0)
          : () =>
              tootStore.loadTootAudio(toot.id).catch(error => {
                // Only audio that's gone offers Delete. Any other error may pass: try again.
                if (error instanceof tootStore.TootAudioMissing) {
                  reportError('toot-audio-missing', error)
                  markAudioMissing(toot.id)
                } else {
                  reportError('toot-audio-read-failed', error)
                  setTootPlayFailed(toot.id)
                }
                throw error
              })
      void play(`toot-${toot.id}`, audio, segment, ended).then(() => {
        if (thisPlay === tootPlays.current) setPlaybackStart({ key, at: performance.now() })
      })
    },
    [nowPlaying, markAudioMissing]
  )

  // As the iPhone app's `renameToot`: the list changes at once, and a failed write is let go.
  const renameToot = useCallback((id: string, title: string) => {
    const trimmed = title.trim()
    if (!trimmed) return
    setToots(list => list?.map(t => (t.id === id ? { ...t, title: trimmed } : t)) ?? null)
    tootStore.renameToot(id, trimmed).catch(error => reportError('toot-rename-failed', error))
  }, [])

  // As the iPhone app's `deleteToot`.
  const deleteToot = useCallback(
    (id: string) => {
      const key = tootPlayback(id)
      if (nowPlaying === key || nowPlaying?.startsWith(`${key}:`)) stopPlayback()
      setToots(list => list?.filter(t => t.id !== id) ?? null)
      forgetDecoded(`toot-${id}`)
      tootStore.deleteToot(id).catch(error => reportError('toot-delete-failed', error))
    },
    [nowPlaying]
  )

  const forgetToot = useCallback((id: string) => {
    forgetDecoded(`toot-${id}`)
    setTootPlayFailed(current => (current === id ? null : current))
  }, [])

  // A Recording placed by ear counts at its Placed Pitch (ADR 0015, ADR 0017).
  const melodicRecordings = (recordings ?? []).filter(r => songPitch(r) !== null)
  const collectedNotes = new Set(
    melodicRecordings.flatMap(r => {
      const pitch = songPitch(r)
      return pitch === null ? [] : [nearestNote(pitch)]
    })
  )

  // The catalog is matched again only when the Melodic Recordings change, as the iPhone app's
  // `CoverageCache`: `key` holds everything Pitch Coverage reads from `recordings`.
  const key = coverageKey(recordings ?? [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `recordings`.
  const rows = useMemo(() => songRows(songs, recordings ?? []), [key])

  const profileStats: ProfileStats | null =
    recordings === null || toots === null
      ? null
      : {
          recordings: recordings.length,
          melodicRecordings: melodicRecordings.length,
          notesCollected: collectedNotes.size,
          unlockedSongs: rows.filter(row => row.coverage.unlocked).length,
          songs: songs.length,
          toots: toots.length
        }

  const value: Pedos = {
    recordings,
    recording: id => recordings?.find(r => r.id === id),
    melodicRecordings,
    collectedNotes,
    collectedPitchClasses: collectedPitchClasses(recordings ?? []),
    songRows: rows,
    showsWelcome,
    capture,
    inputLevel,
    flow,
    problem,
    nowPlaying,
    isSaving,
    showsRecordFlow: capture.kind !== 'idle' || flow !== null,
    finishWelcome,
    startRecording,
    stopRecording,
    dismissProblem: () => setProblem(null),
    saveDraft,
    discardDraft,
    retryAnalysis,
    finishFlow,
    togglePlayback,
    stopPlayback,
    deleteRecording,
    placeRecording,
    rescanning,
    rescanned,
    rescanRecording,
    rescanAll,
    importRecordings,
    toots,
    tootsFailed,
    toot: id => toots?.find(t => t.id === id),
    makeToot,
    makePadToot,
    saveToot,
    toggleTootPlayback,
    tootPlayFailed,
    renameToot,
    deleteToot,
    forgetToot,
    playbackStartedAt:
      playbackStart !== null && playbackStart.key === nowPlaying ? playbackStart.at : null,
    waitsForOtherTabs,
    profileStats
  }
  return <PedosContext value={value}>{children}</PedosContext>
}
