'use client'

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState
} from 'react'
import { analyze } from '@/lib/analysis/client'
import { play, stopPlayback } from '@/lib/audio/player'
import { MicrophoneDeniedError, startTake, type Take } from '@/lib/audio/recorder'
import { nearestNote } from '@/lib/pitch'
import * as store from '@/lib/recording-store'
import {
  maximumTakeSeconds,
  minimumTakeSeconds,
  type Recording,
  recordingPitch,
  replaySegment
} from '@/lib/recordings'
import { encodeWav, type PcmAudio } from '@/lib/wav'
import { waveformLevels } from '@/lib/waveform'

/** A just-recorded take that hasn't been saved or discarded yet. */
export type Draft = { audio: PcmAudio; seconds: number; waveform: number[] }

export type Capture =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'recording'; startedAt: number }
  | { kind: 'finishing' }

/** The full-screen record flow after Stop: Review, then Result, with their error states. */
export type Flow =
  | { kind: 'review'; draft: Draft }
  | { kind: 'saveFailed'; draft: Draft }
  | { kind: 'analyzing'; id: string }
  | { kind: 'analysisFailed'; id: string }
  | { kind: 'result'; id: string }

export type RecordProblem = 'microphoneOff' | 'couldNotStart' | 'interrupted' | 'nothingHeard'

/** What's playing: the draft on Review, or a saved Recording by id. */
export type NowPlaying = 'draft' | string | null

type Pedos = {
  recordings: Recording[] | null
  recording(id: string): Recording | undefined
  /** The Recordings with a Recording Pitch. */
  melodicRecordings: Recording[]
  /** The notes of every Melodic Recording, octave included (G3, G♯3 and G4 are three notes). */
  collectedNotes: Set<number>
  showsWelcome: boolean
  capture: Capture
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
}

const PedosContext = createContext<Pedos | null>(null)

export function usePedos(): Pedos {
  const pedos = useContext(PedosContext)
  if (!pedos) throw new Error('usePedos needs a PedosProvider')
  return pedos
}

const welcomedKey = 'pedos.welcomed'

/** The app's state and actions, mirroring the iPhone app's `AppModel`. */
export function PedosProvider({ children }: { children: ReactNode }) {
  const [recordings, setRecordings] = useState<Recording[] | null>(null)
  const [showsWelcome, setShowsWelcome] = useState(false)
  const [capture, setCapture] = useState<Capture>({ kind: 'idle' })
  const [flow, setFlow] = useState<Flow | null>(null)
  const [problem, setProblem] = useState<RecordProblem | null>(null)
  const [nowPlaying, setNowPlaying] = useState<NowPlaying>(null)
  const [isSaving, setIsSaving] = useState(false)
  const take = useRef<{ take: Take; startedAt: number; limit: number } | null>(null)

  const replace = useCallback((updated: Recording) => {
    setRecordings(list => list?.map(r => (r.id === updated.id ? updated : r)) ?? null)
  }, [])

  const runAnalysis = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const { samples, sampleRate } = await import('@/lib/wav').then(async wav =>
          wav.decodeWav(await store.loadAudio(id))
        )
        const analysis = await analyze({ samples, sampleRate })
        const updated = await store.saveAnalysis(id, { state: 'analyzed', analysis })
        if (updated) replace(updated)
        return true
      } catch {
        const updated = await store.saveAnalysis(id, { state: 'notAnalyzed' })
        if (updated) replace(updated)
        return false
      }
    },
    [replace]
  )

  useEffect(() => {
    setShowsWelcome(localStorage.getItem(welcomedKey) === null)
    store.loadRecordings().then(loaded => {
      // An analysis cut off by closing the page starts again.
      setRecordings(loaded)
      for (const recording of loaded) {
        if (recording.analysis.state === 'analyzing') void runAnalysis(recording.id)
      }
    })
  }, [runAnalysis])

  const finishWelcome = useCallback(() => {
    localStorage.setItem(welcomedKey, '1')
    setShowsWelcome(false)
  }, [])

  const stopRecording = useCallback(async () => {
    const current = take.current
    if (!current) return
    take.current = null
    clearTimeout(current.limit)
    setCapture({ kind: 'finishing' })
    const longEnough = (performance.now() - current.startedAt) / 1000 >= minimumTakeSeconds
    if (!longEnough) {
      current.take.cancel()
      setCapture({ kind: 'idle' })
      setProblem('nothingHeard')
      return
    }
    const audio = await current.take.stop()
    setCapture({ kind: 'idle' })
    if (audio.samples.length === 0) {
      setProblem('nothingHeard')
      return
    }
    setFlow({
      kind: 'review',
      draft: {
        audio,
        seconds: audio.samples.length / audio.sampleRate,
        waveform: waveformLevels(audio.samples, 40)
      }
    })
  }, [])

  const startRecording = useCallback(async () => {
    if (capture.kind !== 'idle' || flow) return
    stopPlayback()
    setProblem(null)
    setCapture({ kind: 'starting' })
    try {
      const started = await startTake(() => {
        // A call or another app took the microphone: the take is lost.
        if (!take.current) return
        clearTimeout(take.current.limit)
        take.current = null
        setCapture({ kind: 'idle' })
        setProblem('interrupted')
      })
      const startedAt = performance.now()
      const limit = window.setTimeout(() => void stopRecording(), maximumTakeSeconds * 1000)
      take.current = { take: started, startedAt, limit }
      setCapture({ kind: 'recording', startedAt: Date.now() })
    } catch (error) {
      setCapture({ kind: 'idle' })
      setProblem(error instanceof MicrophoneDeniedError ? 'microphoneOff' : 'couldNotStart')
    }
  }, [capture.kind, flow, stopRecording])

  const saveDraft = useCallback(async () => {
    if (!flow || (flow.kind !== 'review' && flow.kind !== 'saveFailed') || isSaving) return
    const { draft } = flow
    setIsSaving(true)
    stopPlayback()
    let saved: Recording
    try {
      saved = await store.saveRecording(
        { seconds: draft.seconds, sampleRate: draft.audio.sampleRate, waveform: draft.waveform },
        encodeWav(draft.audio)
      )
    } catch {
      setIsSaving(false)
      setFlow({ kind: 'saveFailed', draft })
      return
    }
    setIsSaving(false)
    setRecordings(list => [...(list ?? []), saved])
    setFlow({ kind: 'analyzing', id: saved.id })
    const analyzed = await runAnalysis(saved.id)
    setFlow(current =>
      current?.kind === 'analyzing' && current.id === saved.id
        ? { kind: analyzed ? 'result' : 'analysisFailed', id: saved.id }
        : current
    )
  }, [flow, isSaving, runAnalysis])

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
      setFlow(current =>
        current?.kind === 'analyzing' && current.id === id
          ? { kind: analyzed ? 'result' : 'analysisFailed', id }
          : current
      )
    },
    [recordings, replace, runAnalysis]
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
        void play(target.id, () => store.loadAudio(target.id), replaySegment(target), ended)
      }
    },
    [flow, nowPlaying]
  )

  const deleteRecording = useCallback(async (id: string) => {
    stopPlayback()
    await store.deleteRecording(id)
    setRecordings(list => list?.filter(r => r.id !== id) ?? null)
  }, [])

  const melodicRecordings = (recordings ?? []).filter(r => recordingPitch(r) !== null)
  const collectedNotes = new Set(
    melodicRecordings.flatMap(r => {
      const pitch = recordingPitch(r)
      return pitch === null ? [] : [nearestNote(pitch)]
    })
  )

  const value: Pedos = {
    recordings,
    recording: id => recordings?.find(r => r.id === id),
    melodicRecordings,
    collectedNotes,
    showsWelcome,
    capture,
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
    deleteRecording
  }
  return <PedosContext value={value}>{children}</PedosContext>
}
