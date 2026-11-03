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
import { loadSongs } from '@/lib/catalog/load-songs'
import { type CoverageChanges, coverageChanges } from '@/lib/pitch-coverage'
import type { AnalysisState, Recording, Trim } from '@/lib/recordings'
import { holdReload } from '@/lib/stale-build'
import type { ReviewChange } from '@/lib/take-review'
import { reportError } from '@/lib/telemetry/errors'
import { useDraftSession } from './draft-session'
import type { Sound } from './playback-provider'
import { useRecordings } from './recordings-provider'
import {
  type Capture,
  type Draft,
  type LiveTake,
  type RecordProblem,
  useTakeCapture
} from './take-capture'

type Flow =
  | { kind: 'review'; draft: Draft }
  | { kind: 'saveFailed'; draft: Draft; review: ReviewChange }
  | { kind: 'analyzing'; id: string }
  | { kind: 'analysisFailed'; id: string; trimFailed?: boolean }
  | { kind: 'result'; id: string; changes: CoverageChanges; trimFailed?: boolean }

type RecordFlow = {
  capture: Capture
  liveTake: LiveTake
  flow: Flow | null
  problem: RecordProblem | null
  isSaving: boolean
  showsRecordFlow: boolean
  reviewOpen: boolean
  setReviewOpen(open: boolean): void
  startRecording(): Promise<void>
  stopRecording(): Promise<void>
  dismissProblem(): void
  draftAnalysis: AnalysisState | null
  draftSound(part: Trim | null): Sound | null
  saveDraft(review?: ReviewChange): Promise<void>
  retryAnalysis(id: string): Promise<void>
  closeFlow(): void
}

const RecordFlowContext = createContext<RecordFlow | null>(null)

export function useRecordFlow(): RecordFlow {
  const recordFlow = useContext(RecordFlowContext)
  if (!recordFlow) throw new Error('useRecordFlow needs a RecordFlowProvider')
  return recordFlow
}

function whenAnalyzing(id: string, next: Flow) {
  return (current: Flow | null) =>
    current?.kind === 'analyzing' && current.id === id ? next : current
}

function savedFields(draft: Draft, { placedPitch, name }: ReviewChange) {
  return {
    seconds: draft.seconds,
    sampleRate: draft.audio.sampleRate,
    waveform: draft.waveform,
    ...(placedPitch == null ? {} : { placedPitch }),
    ...(name == null ? {} : { name })
  }
}

export function RecordFlowProvider({ children }: { children: ReactNode }) {
  const { recordings, saveRecording, analyze, keepAnalysis, reanalyze, placeRecording } =
    useRecordings()
  const [flow, setFlow] = useState<Flow | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const latest = useRef<Recording[] | null>(null)
  useEffect(() => {
    latest.current = recordings
  }, [recordings])

  const review = useCallback((draft: Draft) => setFlow({ kind: 'review', draft }), [])
  const { capture, problem, liveTake, startRecording, stopRecording, dismissProblem } =
    useTakeCapture(flow !== null, review)
  const reviewing = flow?.kind === 'review' || flow?.kind === 'saveFailed' ? flow.draft : null
  const { sessionOf, draftAnalysis, letGoOfDraft, draftSound } = useDraftSession(reviewing)

  const afterAnalysis = useCallback(
    async (id: string, analyzed: Recording | null, trimFailed: boolean): Promise<Flow> => {
      const failedTrim = trimFailed ? { trimFailed } : {}
      if (!analyzed) return { kind: 'analysisFailed', id, ...failedTrim }
      const catalog = await loadSongs().catch(() => [])
      const others = (latest.current ?? []).filter(r => r.id !== analyzed.id)
      return {
        kind: 'result',
        id: analyzed.id,
        changes: coverageChanges(catalog, others, [...others, analyzed]),
        ...failedTrim
      }
    },
    []
  )

  const showsRecordFlow = capture.kind !== 'idle' || flow !== null
  useEffect(() => (showsRecordFlow ? holdReload() : undefined), [showsRecordFlow])

  const saveDraft = useCallback(
    async (change?: ReviewChange) => {
      if (!flow || (flow.kind !== 'review' && flow.kind !== 'saveFailed') || isSaving) return
      const { draft } = flow
      const changes = change ?? (flow.kind === 'saveFailed' ? flow.review : {})
      const session = sessionOf(draft)
      setIsSaving(true)
      stopPlayback()
      let saved: Recording
      try {
        saved = await saveRecording(savedFields(draft, changes), session.wav)
      } catch (error) {
        reportError('recording-save-failed', error)
        setIsSaving(false)
        setFlow({ kind: 'saveFailed', draft, review: changes })
        return
      }
      setIsSaving(false)
      setFlow({ kind: 'analyzing', id: saved.id })
      letGoOfDraft()
      const trimmed = changes.handles
        ? await placeRecording(saved.id, { handles: changes.handles })
        : true
      const kept = await keepAnalysis(saved.id, await session.analysis)
      const analyzed = kept
        ? kept.analysis.state === 'analyzed'
          ? kept
          : null
        : await analyze(saved.id)
      setFlow(whenAnalyzing(saved.id, await afterAnalysis(saved.id, analyzed, !trimmed)))
    },
    [
      flow,
      isSaving,
      sessionOf,
      letGoOfDraft,
      saveRecording,
      placeRecording,
      keepAnalysis,
      analyze,
      afterAnalysis
    ]
  )

  const retryAnalysis = useCallback(
    async (id: string) => {
      const analysis = reanalyze(id)
      if (!analysis) return
      const trimFailed = flow?.kind === 'analysisFailed' && flow.id === id && !!flow.trimFailed
      setFlow(current =>
        current?.kind === 'analysisFailed' && current.id === id
          ? { kind: 'analyzing', id }
          : current
      )
      const analyzed = await analysis
      setFlow(whenAnalyzing(id, await afterAnalysis(id, analyzed, trimFailed)))
    },
    [flow, reanalyze, afterAnalysis]
  )

  const closeFlow = useCallback(() => {
    stopPlayback()
    letGoOfDraft()
    setFlow(null)
  }, [letGoOfDraft])

  const flowRecordingId = flow && 'id' in flow ? flow.id : null
  useEffect(() => {
    if (flowRecordingId === null || recordings === null) return
    if (!recordings.some(recording => recording.id === flowRecordingId)) closeFlow()
  }, [flowRecordingId, recordings, closeFlow])

  const value = useMemo(
    (): RecordFlow => ({
      capture,
      liveTake,
      flow,
      problem,
      isSaving,
      showsRecordFlow,
      reviewOpen,
      setReviewOpen,
      startRecording,
      stopRecording,
      dismissProblem,
      draftAnalysis,
      draftSound,
      saveDraft,
      retryAnalysis,
      closeFlow
    }),
    [
      capture,
      liveTake,
      flow,
      problem,
      isSaving,
      showsRecordFlow,
      reviewOpen,
      startRecording,
      stopRecording,
      dismissProblem,
      draftAnalysis,
      draftSound,
      saveDraft,
      retryAnalysis,
      closeFlow
    ]
  )
  return <RecordFlowContext value={value}>{children}</RecordFlowContext>
}
