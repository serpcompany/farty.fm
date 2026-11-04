'use client'

import { usePathname } from 'next/navigation'
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
import { preload } from 'react-dom'
import { analyze, findTrim } from '@/lib/analysis/client'
import { type RescanResult, rescan, upgradeAnalyses } from '@/lib/analysis-upgrade'
import { forgetDecoded, play, playbackPosition, stopPlayback } from '@/lib/audio/player'
import {
  MicrophoneDeniedError,
  MicrophoneReleasedError,
  startTake,
  type Take
} from '@/lib/audio/recorder'
import { catalogPath } from '@/lib/catalog/catalog-path.generated'
import { loadSongs } from '@/lib/catalog/load-songs'
import type { Song, SongSummary } from '@/lib/catalog/song'
import { loadFavorites } from '@/lib/favorite-store'
import { onLibraryChanged, recordingsAfter } from '@/lib/library-sync'
import type { Performance } from '@/lib/performance'
import { nearestNote } from '@/lib/pitch'
import {
  type Coverage,
  type CoverageChanges,
  collectedPitchClasses,
  coverageChanges,
  coverageKey,
  coverageOf,
  orderUnlocked,
  type SongRow,
  songRows
} from '@/lib/pitch-coverage'
import * as store from '@/lib/recording-store'
import {
  type AnalysisState,
  atFullLevel,
  heardSomething,
  maximumTakeSeconds,
  type Recording,
  type RecordingTrim,
  songPitch,
  TakeLevels,
  type Trim,
  trimHandles
} from '@/lib/recordings'
import { holdReload } from '@/lib/stale-build'
import type { ReviewChange } from '@/lib/take-review'
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
 * Record's states (#281, #314): getting the microphone ready, recording once its audio comes in
 * (never before), and finishing the take after Stop. `hearsNothing`: about 2 s in, the take so far
 * is one `heardSomething` would refuse, so Record says it can't hear anything. The take goes on.
 */
export type Capture =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'recording'; startedAt: number; hearsNothing: boolean }
  | { kind: 'finishing'; startedAt: number; stoppedAt: number }

/** How long a take records before Record says it can't hear anything, if it can't. */
export const hintAfterMs = 2000

/**
 * Record's live waveform (#314): the take so far, one bar per 50 ms, 0…1 (`TakeLevels.bars`).
 * It's kept outside React state, so only the waveform redraws with each batch:
 * `useSyncExternalStore(subscribe, bars)`. Empty between takes.
 */
export type LiveTake = {
  bars(): readonly number[]
  subscribe(listener: () => void): () => void
}

const noBars: readonly number[] = []

function liveTakeStore(): LiveTake & { set(bars: readonly number[]): void } {
  let bars = noBars
  const listeners = new Set<() => void>()
  return {
    bars: () => bars,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(next) {
      if (next.length === bars.length) return
      // A copy, so each change is a new snapshot.
      bars = next.length === 0 ? noBars : next.slice()
      for (const listener of listeners) listener()
    }
  }
}

/** The take being recorded, with its timers: the 30 s limit and the hint's 2 s. */
type TakeInProgress = { take: Take; startedAt: number; limit: number; hint: number }

/** Clears the take's timers, as it stops or is lost. */
function letGo(current: TakeInProgress): void {
  clearTimeout(current.limit)
  clearTimeout(current.hint)
}

/** A short buzz as Record starts recording, where the browser can (not Safari on iPhone). */
function buzz(): void {
  try {
    if ('vibrate' in window.navigator) window.navigator.vibrate(40)
  } catch {
    // A browser that refuses it: the red screen still shows Record records.
  }
}

/**
 * The full-screen record flow after Stop: Review, then Result, with their error states. A save
 * that failed keeps what the review changed, for Try again. `trimFailed`: the take was saved, but
 * the fart between the review's handles couldn't be found, so it has no Trim.
 */
export type Flow =
  | { kind: 'review'; draft: Draft }
  | { kind: 'saveFailed'; draft: Draft; review: ReviewChange }
  | { kind: 'analyzing'; id: string }
  | { kind: 'analysisFailed'; id: string; trimFailed?: boolean }
  | { kind: 'result'; id: string; changes: CoverageChanges; trimFailed?: boolean }

export type RecordProblem = 'microphoneOff' | 'couldNotStart' | 'interrupted' | 'nothingHeard'

/**
 * What's playing: the draft on its review, a saved Recording by id, or a Toot or one of its notes
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
  /**
   * The Song Catalog this build ships, in the app's order, without the Songs' notes; null
   * until it loads. It's fetched as data (#322), and kept for offline use by the service worker.
   * A Song's notes load when it's opened (`loadSong`, #323).
   */
  songs: readonly SongSummary[] | null
  /** The Song Catalog didn't load. `reloadSongs` tries again, as does coming back online. */
  songsFailed: boolean
  reloadSongs(): void
  /** The Song of this id, once the catalog has loaded. */
  song(id: string): SongSummary | undefined
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
  /** Every Song with its Pitch Coverage, in catalog order: counted, not arranged (#323). */
  songRows: SongRow[]
  /**
   * A Song's Pitch Coverage with the notes it still needs, from Auto-map's Arrangement: worked out
   * when first asked for, and kept until the Recordings change, so Compose arranges only the
   * Songs it shows notes for (#323).
   */
  coverage(song: SongSummary): Coverage
  showsWelcome: boolean
  capture: Capture
  /** The take's live waveform while recording and finishing; empty otherwise. */
  liveTake: LiveTake
  flow: Flow | null
  problem: RecordProblem | null
  nowPlaying: NowPlaying
  isSaving: boolean
  /** Recording, Review or Result is on screen, full screen over the tabs. */
  showsRecordFlow: boolean
  /** A saved Recording's review, from its pencil, is open over the tabs (#314). */
  reviewOpen: boolean
  setReviewOpen(open: boolean): void
  finishWelcome(): void
  startRecording(): Promise<void>
  stopRecording(): Promise<void>
  dismissProblem(): void
  /**
   * What analysis has found in the take on review so far (#314): it starts at Stop, so the review
   * shows the note once it's found. Null while no take is on review.
   */
  draftAnalysis: AnalysisState | null
  /**
   * Saves the take on review at once, with the note, name and Trim the review changed, then waits
   * for its analysis to show Result. Saving never waits for analysis (ADR 0002).
   */
  saveDraft(review?: ReviewChange): Promise<void>
  discardDraft(): void
  retryAnalysis(id: string): Promise<void>
  finishFlow(): void
  /**
   * Plays or stops the draft, or a Recording: its Trim if it has one (ADR 0019), or else the whole
   * take (ADR 0016). With `part`, just that part of the take, as the review plays the fart.
   */
  togglePlayback(target: 'draft' | Recording, part?: Trim): void
  /** Plays `part` of the draft's or a Recording's take, from its start, as a scrub lets go. */
  playRecording(target: 'draft' | Recording, part: Trim): void
  stopPlayback(): void
  /** The part of the take playing, while `nowPlaying` is the draft or a Recording. */
  playingPart: Trim | null
  /**
   * Where what's playing is now, in seconds of its whole take, by the audio clock: what the
   * playhead follows. Null while nothing plays, or it still loads.
   */
  playbackPosition(): number | null
  deleteRecording(id: string): Promise<void>
  /**
   * What a Recording's review saves (#314): places it on a MIDI note by ear, leaves it out with
   * `NO_NOTE`, or has it follow analysis with null (ADR 0015); trims it to `handles`, or takes its
   * Trim off with null (ADR 0019); and names it, or takes its name off with null. A field left out
   * stays. Every Song uses it at once; it still plays raw, at its own pitch. False when the fart
   * between the handles couldn't be found, and then nothing changes.
   */
  placeRecording(id: string, change: ReviewChange): Promise<boolean>
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
   * `isAudioMissing`; one whose audio couldn't be read this time is `tootPlayFailed`. A saved
   * Toot's note is found in its audio by its Song's notes (`loadSong`), which its screen gives.
   */
  toggleTootPlayback(toot: TootDraft | Toot, note?: number, notes?: Song): void
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
  /** Profile's counts; null until the Recordings, the Toots and the Song Catalog load. */
  profileStats: ProfileStats | null
}

const PedosContext = createContext<Pedos | null>(null)

export function usePedos(): Pedos {
  const pedos = useContext(PedosContext)
  if (!pedos) throw new Error('usePedos needs a PedosProvider')
  return pedos
}

/**
 * The Trim the review's `handles` keep in a Recording's take (ADR 0019): the handles exactly, which
 * the row and the review play, and the fart between them, found as Recording Analysis finds a fart
 * (`trimBounds`), which Songs play.
 */
async function trimBetween(id: string, handles: Trim): Promise<RecordingTrim> {
  const fart = await findTrim(decodeWav(await store.loadAudio(id)), handles)
  return { startSeconds: handles.startSeconds, endSeconds: handles.endSeconds, fart }
}

/**
 * The take on review, encoded once as the WAV it saves as: its analysis, started at Stop on that
 * WAV so it finds what a saved Recording's would, and the key its decoded audio plays under.
 */
type DraftSession = {
  draft: Draft
  wav: ArrayBuffer
  key: string
  analysis: Promise<AnalysisState>
}

/** The app's state and actions, mirroring the iPhone app's `AppModel`. */
export function PedosProvider({ children }: { children: ReactNode }) {
  // A shared Recording's public page (ADR 0020) reads no Song, and mostly people without the app
  // open it, so it neither names nor fetches the catalog.
  const wantsSongs = !usePathname()?.startsWith('/u/')
  // Every app page's head names the catalog, so it downloads beside the scripts, and the service
  // worker keeps it with the page's other files (public/sw.js).
  if (wantsSongs) preload(catalogPath, { as: 'fetch', crossOrigin: 'anonymous' })
  const [songs, setSongs] = useState<readonly SongSummary[] | null>(null)
  const songById = useMemo(() => new Map(songs?.map(song => [song.id, song])), [songs])
  const [songsFailed, setSongsFailed] = useState(false)
  /** Bumped by `reloadSongs`, to fetch the catalog again. */
  const [songsAttempt, setSongsAttempt] = useState(0)
  const [recordings, setRecordings] = useState<Recording[] | null>(null)
  const [showsWelcome, setShowsWelcome] = useState(false)
  const [capture, setCapture] = useState<Capture>({ kind: 'idle' })
  const [flow, setFlow] = useState<Flow | null>(null)
  const [problem, setProblem] = useState<RecordProblem | null>(null)
  const [nowPlaying, setNowPlaying] = useState<NowPlaying>(null)
  const [playingPart, setPlayingPart] = useState<Trim | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
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
  const draftSession = useRef<DraftSession | null>(null)
  const [draftAnalyzed, setDraftAnalyzed] = useState<{ draft: Draft; state: AnalysisState } | null>(
    null
  )
  const [liveTake] = useState(liveTakeStore)
  // The Recordings as last rendered, to compare Pitch Coverage after an analysis.
  const latest = useRef<Recording[] | null>(null)
  useEffect(() => {
    latest.current = recordings
  }, [recordings])

  // An analysis, a Re-scan's and the upgrade's among them, changes only the analysis, so a Placed
  // Pitch or Trim the user saved while it ran stays on screen (ADR 0017, ADR 0019).
  const replace = useCallback((updated: Recording) => {
    setRecordings(
      list =>
        list?.map(r => (r.id === updated.id ? { ...r, analysis: updated.analysis } : r)) ?? null
    )
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

  // The Song Catalog, fetched once for the app (#322).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `songsAttempt` is what Try again changes.
  useEffect(() => {
    if (!wantsSongs) return
    let left = false
    loadSongs().then(
      loaded => {
        if (left) return
        setSongs(loaded)
        setSongsFailed(false)
      },
      error => {
        reportError('catalog-load-failed', error)
        if (!left) setSongsFailed(true)
      }
    )
    return () => {
      left = true
    }
  }, [songsAttempt, wantsSongs])
  const reloadSongs = useCallback(() => {
    setSongsFailed(false)
    setSongsAttempt(n => n + 1)
  }, [])
  // A catalog that failed for want of a network loads once the browser is back online.
  useEffect(() => {
    if (!songsFailed) return
    window.addEventListener('online', reloadSongs)
    return () => window.removeEventListener('online', reloadSongs)
  }, [songsFailed, reloadSongs])

  /**
   * The Result screen after analysis, with what the Recording changed in the Song Catalog's Pitch
   * Coverage: the iPhone app's `analyze()` compares the Recordings before and after it. It waits
   * for the catalog, should it still be loading; without one, nothing changed. The Songs it
   * unlocked come best first, Favorites first, in an order fixed now, so a heart tapped on the
   * Result doesn't move a row and Try it opens the first (#363).
   */
  const resultOf = useCallback(async (analyzed: Recording, trimFailed = false): Promise<Flow> => {
    const [catalog, favorites] = await Promise.all([
      loadSongs().catch(() => []),
      loadFavorites().catch(() => [])
    ])
    const others = (latest.current ?? []).filter(r => r.id !== analyzed.id)
    const changes = coverageChanges(catalog, others, [...others, analyzed])
    return {
      kind: 'result',
      id: analyzed.id,
      changes: { ...changes, unlocked: orderUnlocked(changes.unlocked, new Set(favorites)) },
      ...(trimFailed ? { trimFailed } : {})
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
    letGo(current)
    // The waveform holds while the take finishes.
    setCapture({ kind: 'finishing', startedAt: current.startedAt, stoppedAt: Date.now() })
    const audio = await current.take.stop()
    liveTake.set(noBars)
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
  }, [liveTake])

  const startRecording = useCallback(async () => {
    if (capture.kind !== 'idle' || flow) return
    stopPlayback()
    setProblem(null)
    liveTake.set(noBars)
    setCapture({ kind: 'starting' })
    try {
      const started = await startTake(
        () => {
          // A call or another app took the microphone: the take is lost.
          if (!take.current) return
          letGo(take.current)
          take.current = null
          liveTake.set(noBars)
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
      // The waveform and the hint follow the take's own batches (#281). The hint is the test Stop
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
        liveTake.set(levels.bars)
        if (judging) judge()
      })
      current.hint = window.setTimeout(() => {
        judging = true
        judge()
      }, hintAfterMs)
      setCapture({ kind: 'recording', startedAt: current.startedAt, hearsNothing: false })
      buzz()
    } catch (error) {
      // Something failed after the take started: it stops capturing, rather than running on to
      // its 30 s limit behind the idle screen.
      const lost = take.current
      if (lost) {
        take.current = null
        letGo(lost)
        lost.take.cancel()
      }
      liveTake.set(noBars)
      setCapture({ kind: 'idle' })
      // The page was hidden, or widened into the product page, before the microphone opened.
      if (error instanceof MicrophoneReleasedError) return
      const denied = error instanceof MicrophoneDeniedError
      reportError(denied ? 'mic-denied' : 'mic-start-failed', error)
      setProblem(denied ? 'microphoneOff' : 'couldNotStart')
    }
  }, [capture.kind, flow, stopRecording, liveTake])

  // A new build's reload waits for the take and the record flow after it to close
  // (`stale-build.ts`, #222).
  const recordFlowOpen = capture.kind !== 'idle' || flow !== null
  useEffect(() => (recordFlowOpen ? holdReload() : undefined), [recordFlowOpen])

  /** The take on review's session, started the first time it's asked for. */
  const sessionOf = useCallback((draft: Draft): DraftSession => {
    const current = draftSession.current
    if (current?.draft === draft) return current
    if (current) forgetDecoded(current.key)
    const wav = encodeWav(draft.audio)
    const analysis = analyze(decodeWav(wav)).then(
      (found): AnalysisState => ({ state: 'analyzed', analysis: found }),
      (error): AnalysisState => {
        reportError('analysis-failed', error)
        return { state: 'notAnalyzed' }
      }
    )
    const session = { draft, wav, key: `draft-${crypto.randomUUID()}`, analysis }
    draftSession.current = session
    void analysis.then(state => {
      if (draftSession.current === session) setDraftAnalyzed({ draft, state })
    })
    return session
  }, [])

  // Analysis starts as the take comes up for review (#314), so its note shows there.
  const reviewing = flow?.kind === 'review' || flow?.kind === 'saveFailed' ? flow.draft : null
  useEffect(() => {
    if (reviewing) sessionOf(reviewing)
  }, [reviewing, sessionOf])
  const draftAnalysis: AnalysisState | null =
    reviewing === null
      ? null
      : draftAnalyzed?.draft === reviewing
        ? draftAnalyzed.state
        : { state: 'analyzing' }

  /** Lets go of the take on review: its decoded audio, and its analysis's result. */
  const letGoOfDraft = useCallback(() => {
    if (draftSession.current) forgetDecoded(draftSession.current.key)
    draftSession.current = null
    setDraftAnalyzed(null)
  }, [])

  // As `renameToot`: the list, and so every Song's coverage, changes at once. A Trim keeps the
  // handles as they are, and its fart is found first, in the analysis worker (`trimBounds`, ADR
  // 0019). If that fails, nothing is saved and the review says so.
  const placeRecording = useCallback(
    async (id: string, { placedPitch, handles, name }: ReviewChange) => {
      const change: store.Placement = {}
      if (placedPitch !== undefined) change.placedPitch = placedPitch
      if (name !== undefined) change.name = name
      try {
        if (handles !== undefined) change.trim = handles && (await trimBetween(id, handles))
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
    },
    []
  )

  // The take is saved at once, with the review's note and name; its Trim and analysis follow, and
  // Result waits for them (ADR 0002).
  const saveDraft = useCallback(
    async (review?: ReviewChange) => {
      if (!flow || (flow.kind !== 'review' && flow.kind !== 'saveFailed') || isSaving) return
      const { draft } = flow
      const changes = review ?? (flow.kind === 'saveFailed' ? flow.review : {})
      const session = sessionOf(draft)
      setIsSaving(true)
      stopPlayback()
      let saved: Recording
      try {
        // Saved after the visit has started, so what its open clears (the last visit's farts, a
        // library an account left, or another account's at sign-in) never takes it.
        await openVisit().library
        const { placedPitch, name } = changes
        saved = await store.saveRecording(
          {
            seconds: draft.seconds,
            sampleRate: draft.audio.sampleRate,
            waveform: draft.waveform,
            ...(placedPitch == null ? {} : { placedPitch }),
            ...(name == null ? {} : { name })
          },
          session.wav
        )
      } catch (error) {
        reportError('recording-save-failed', error)
        setIsSaving(false)
        setFlow({ kind: 'saveFailed', draft, review: changes })
        return
      }
      setIsSaving(false)
      setRecordings(list => [...(list ?? []), saved])
      setFlow({ kind: 'analyzing', id: saved.id })
      letGoOfDraft()
      // The Trim's fart is found in the analysis worker, after the take's analysis. If it isn't
      // found, the take stays whole, and Result says so.
      const trimmed = changes.handles
        ? await placeRecording(saved.id, { handles: changes.handles })
        : true
      const state = await session.analysis
      const kept = await store.saveAnalysis(saved.id, state).catch(error => {
        reportError('analysis-failed', error)
        return null
      })
      if (kept) replace(kept)
      // Analysis at Stop failed: the Recording is kept as not analyzed, and Retry runs it again. If
      // keeping its analysis failed, analysis runs once more on the saved take.
      const analyzed = kept
        ? kept.analysis.state === 'analyzed'
          ? kept
          : null
        : await runAnalysis(saved.id)
      const next: Flow = analyzed
        ? await resultOf(analyzed, !trimmed)
        : { kind: 'analysisFailed', id: saved.id, ...(trimmed ? {} : { trimFailed: true }) }
      setFlow(current =>
        current?.kind === 'analyzing' && current.id === saved.id ? next : current
      )
    },
    [flow, isSaving, sessionOf, letGoOfDraft, placeRecording, replace, runAnalysis, resultOf]
  )

  const discardDraft = useCallback(() => {
    stopPlayback()
    letGoOfDraft()
    setFlow(null)
  }, [letGoOfDraft])

  const retryAnalysis = useCallback(
    async (id: string) => {
      const recording = recordings?.find(r => r.id === id)
      if (!recording || recording.analysis.state !== 'notAnalyzed') return
      // A Trim that failed before analysis did is still said on Result after Retry.
      const trimFailed = flow?.kind === 'analysisFailed' && flow.id === id && !!flow.trimFailed
      replace({ ...recording, analysis: { state: 'analyzing' } })
      setFlow(current =>
        current?.kind === 'analysisFailed' && current.id === id
          ? { kind: 'analyzing', id }
          : current
      )
      const analyzed = await runAnalysis(id)
      const next: Flow = analyzed
        ? await resultOf(analyzed, trimFailed)
        : { kind: 'analysisFailed', id, ...(trimFailed ? { trimFailed } : {}) }
      setFlow(current => (current?.kind === 'analyzing' && current.id === id ? next : current))
    },
    [flow, recordings, replace, runAnalysis, resultOf]
  )

  const finishFlow = useCallback(() => {
    stopPlayback()
    setFlow(null)
  }, [])

  const playRecording = useCallback((target: 'draft' | Recording, part: Trim | null) => {
    const key = target === 'draft' ? 'draft' : target.id
    // The take on review isn't saved yet: it plays from its session's WAV, decoded once under its
    // own key. Decoding takes the buffer it's given, so it gets a copy.
    const session = target === 'draft' ? draftSession.current : null
    if (target === 'draft' && !session) return
    const ended = () => setNowPlaying(current => (current === key ? null : current))
    setNowPlaying(key)
    const seconds = target === 'draft' ? (session?.draft.seconds ?? 0) : target.seconds
    setPlayingPart(part ?? { startSeconds: 0, endSeconds: seconds })
    // The whole take, start to end, as recorded (ADR 0016), unless it's trimmed (ADR 0019) or the
    // review or a scrub plays a part of it.
    const segment = part && { start: part.startSeconds, end: part.endSeconds }
    if (session) void play(session.key, async () => session.wav.slice(0), segment, ended)
    else void play(key, () => store.loadAudio(key), segment, ended)
  }, [])

  const togglePlayback = useCallback(
    (target: 'draft' | Recording, part?: Trim) => {
      const key = target === 'draft' ? 'draft' : target.id
      if (nowPlaying === key) {
        stopPlayback()
        return
      }
      playRecording(target, part ?? (target === 'draft' ? null : trimHandles(target)))
    },
    [nowPlaying, playRecording]
  )

  const deleteRecording = useCallback(async (id: string) => {
    stopPlayback()
    await store.deleteRecording(id)
    setRecordings(list => list?.filter(r => r.id !== id) ?? null)
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
    (toot: TootDraft | Toot, note?: number, notes?: Song) => {
      const key = tootPlayback(toot.id, note)
      setTootPlayFailed(null)
      if (nowPlaying === key) {
        stopPlayback()
        return
      }
      const song = 'song' in toot ? toot.song : toot.songId === notes?.id ? notes : undefined
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
  const rows = useMemo(() => songRows(songs ?? [], recordings ?? []), [key, songs])
  // Each Song's Arrangement, once asked for, while the Recordings stay as they are.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `recordings`.
  const coverage = useMemo(() => {
    const arranged = new Map<SongSummary, Coverage>()
    const current = recordings ?? []
    return (song: SongSummary) => {
      let found = arranged.get(song)
      if (!found) {
        found = coverageOf(song, current)
        arranged.set(song, found)
      }
      return found
    }
  }, [key])

  const profileStats: ProfileStats | null =
    recordings === null || toots === null || songs === null
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
    songs,
    songsFailed,
    reloadSongs,
    song: id => songById.get(id),
    recordings,
    recording: id => recordings?.find(r => r.id === id),
    melodicRecordings,
    collectedNotes,
    collectedPitchClasses: collectedPitchClasses(recordings ?? []),
    songRows: rows,
    coverage,
    showsWelcome,
    capture,
    liveTake,
    flow,
    problem,
    nowPlaying,
    isSaving,
    showsRecordFlow: capture.kind !== 'idle' || flow !== null,
    reviewOpen,
    setReviewOpen,
    finishWelcome,
    startRecording,
    stopRecording,
    dismissProblem: () => setProblem(null),
    draftAnalysis,
    saveDraft,
    discardDraft,
    retryAnalysis,
    finishFlow,
    togglePlayback,
    playRecording,
    stopPlayback,
    playingPart,
    playbackPosition,
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
