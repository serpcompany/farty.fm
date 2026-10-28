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
import { stopPlayback } from '@/lib/audio/player'
import {
  MicrophoneDeniedError,
  MicrophoneReleasedError,
  startTake,
  type Take
} from '@/lib/audio/recorder'
import { songs } from '@/lib/catalog/songs.generated'
import { type CoverageChanges, coverageChanges } from '@/lib/pitch-coverage'
import { heardSomething, maximumTakeSeconds, type Recording } from '@/lib/recordings'
import { holdReload } from '@/lib/stale-build'
import { reportError } from '@/lib/telemetry/errors'
import { encodeWav, type PcmAudio } from '@/lib/wav'
import { waveformLevels } from '@/lib/waveform'
import { useRecordings } from './recordings-provider'

export type Draft = { audio: PcmAudio; seconds: number; waveform: number[] }

type Capture =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'recording'; startedAt: number }
  | { kind: 'finishing' }

type Flow =
  | { kind: 'review'; draft: Draft }
  | { kind: 'saveFailed'; draft: Draft }
  | { kind: 'analyzing'; id: string }
  | { kind: 'analysisFailed'; id: string }
  | { kind: 'result'; id: string; changes: CoverageChanges }

export type RecordProblem = 'microphoneOff' | 'couldNotStart' | 'interrupted' | 'nothingHeard'

type RecordFlow = {
  capture: Capture
  flow: Flow | null
  problem: RecordProblem | null
  isSaving: boolean
  showsRecordFlow: boolean
  startRecording(): Promise<void>
  stopRecording(): Promise<void>
  dismissProblem(): void
  saveDraft(): Promise<void>
  retryAnalysis(id: string): Promise<void>
  closeFlow(): void
}

const RecordFlowContext = createContext<RecordFlow | null>(null)

export function useRecordFlow(): RecordFlow {
  const recordFlow = useContext(RecordFlowContext)
  if (!recordFlow) throw new Error('useRecordFlow needs a RecordFlowProvider')
  return recordFlow
}

function draftOf(audio: PcmAudio): Draft {
  return {
    audio,
    seconds: audio.samples.length / audio.sampleRate,
    waveform: waveformLevels(audio.samples, 40)
  }
}

function whenAnalyzing(id: string, next: Flow) {
  return (current: Flow | null) =>
    current?.kind === 'analyzing' && current.id === id ? next : current
}

export function RecordFlowProvider({ children }: { children: ReactNode }) {
  const { recordings, saveRecording, analyze, reanalyze } = useRecordings()
  const [capture, setCapture] = useState<Capture>({ kind: 'idle' })
  const [flow, setFlow] = useState<Flow | null>(null)
  const [problem, setProblem] = useState<RecordProblem | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const take = useRef<{ take: Take; limit: number } | null>(null)
  const latest = useRef<Recording[] | null>(null)
  useEffect(() => {
    latest.current = recordings
  }, [recordings])

  const afterAnalysis = useCallback((id: string, analyzed: Recording | null): Flow => {
    if (!analyzed) return { kind: 'analysisFailed', id }
    const others = (latest.current ?? []).filter(r => r.id !== analyzed.id)
    return {
      kind: 'result',
      id: analyzed.id,
      changes: coverageChanges(songs, others, [...others, analyzed])
    }
  }, [])

  const stopRecording = useCallback(async () => {
    const current = take.current
    if (!current) return
    take.current = null
    clearTimeout(current.limit)
    setCapture({ kind: 'finishing' })
    const audio = await current.take.stop()
    setCapture({ kind: 'idle' })
    if (audio.samples.length === 0 || !heardSomething(audio.samples, audio.sampleRate)) {
      setProblem('nothingHeard')
      return
    }
    setFlow({ kind: 'review', draft: draftOf(audio) })
  }, [])

  const loseTake = useCallback(() => {
    if (!take.current) return
    clearTimeout(take.current.limit)
    take.current = null
    setCapture({ kind: 'idle' })
    setProblem('interrupted')
  }, [])

  const startRecording = useCallback(async () => {
    if (capture.kind !== 'idle' || flow) return
    stopPlayback()
    setProblem(null)
    setCapture({ kind: 'starting' })
    try {
      const started = await startTake(loseTake)
      const limit = window.setTimeout(() => void stopRecording(), maximumTakeSeconds * 1000)
      take.current = { take: started, limit }
      setCapture({ kind: 'recording', startedAt: Date.now() })
    } catch (error) {
      setCapture({ kind: 'idle' })
      if (error instanceof MicrophoneReleasedError) return
      const denied = error instanceof MicrophoneDeniedError
      reportError(denied ? 'mic-denied' : 'mic-start-failed', error)
      setProblem(denied ? 'microphoneOff' : 'couldNotStart')
    }
  }, [capture.kind, flow, loseTake, stopRecording])

  const showsRecordFlow = capture.kind !== 'idle' || flow !== null
  useEffect(() => (showsRecordFlow ? holdReload() : undefined), [showsRecordFlow])

  const saveDraft = useCallback(async () => {
    if (!flow || (flow.kind !== 'review' && flow.kind !== 'saveFailed') || isSaving) return
    const { draft } = flow
    setIsSaving(true)
    stopPlayback()
    let saved: Recording
    try {
      saved = await saveRecording(
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
    setFlow({ kind: 'analyzing', id: saved.id })
    const analyzed = await analyze(saved.id)
    setFlow(whenAnalyzing(saved.id, afterAnalysis(saved.id, analyzed)))
  }, [flow, isSaving, saveRecording, analyze, afterAnalysis])

  const retryAnalysis = useCallback(
    async (id: string) => {
      const analysis = reanalyze(id)
      if (!analysis) return
      setFlow(current =>
        current?.kind === 'analysisFailed' && current.id === id
          ? { kind: 'analyzing', id }
          : current
      )
      const analyzed = await analysis
      setFlow(whenAnalyzing(id, afterAnalysis(id, analyzed)))
    },
    [reanalyze, afterAnalysis]
  )

  const closeFlow = useCallback(() => {
    stopPlayback()
    setFlow(null)
  }, [])

  const dismissProblem = useCallback(() => setProblem(null), [])

  const value = useMemo(
    (): RecordFlow => ({
      capture,
      flow,
      problem,
      isSaving,
      showsRecordFlow,
      startRecording,
      stopRecording,
      dismissProblem,
      saveDraft,
      retryAnalysis,
      closeFlow
    }),
    [
      capture,
      flow,
      problem,
      isSaving,
      showsRecordFlow,
      startRecording,
      stopRecording,
      dismissProblem,
      saveDraft,
      retryAnalysis,
      closeFlow
    ]
  )
  return <RecordFlowContext value={value}>{children}</RecordFlowContext>
}
