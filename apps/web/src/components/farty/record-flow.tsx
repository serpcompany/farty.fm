'use client'

import { CircleAlert } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'
import { type Recording, recordingName } from '@/lib/recordings'
import { cn } from '@/lib/utils'
import { Cover, FlowButton, FlowButtons } from './record-cover'
import { useRecordFlow } from './record-flow-provider'
import { AnalysisFailed, Result } from './record-result'
import { useRecordings } from './recordings-provider'
import { ShareRecordingButton } from './share-recording'
import type { Draft } from './take-capture'
import { TakeReview, useTakeReview } from './take-review'
import { LiveWaveform } from './waveform'

export function RecordFlow() {
  const { flow, capture } = useRecordFlow()
  const { recording } = useRecordings()

  if (!flow && capture.kind === 'starting') {
    return (
      <Cover label="Getting the mic ready">
        <GettingReady />
      </Cover>
    )
  }
  if (!flow && (capture.kind === 'recording' || capture.kind === 'finishing')) {
    return (
      <Cover label="Recording" tone="record">
        <RecordingStep />
      </Cover>
    )
  }
  if (!flow) return null

  switch (flow.kind) {
    case 'review':
      return (
        <Cover title="New Recording">
          <Review draft={flow.draft} />
        </Cover>
      )
    case 'saveFailed':
      return (
        <Cover title="New Recording">
          <SaveFailed />
        </Cover>
      )
    case 'analyzing':
      return (
        <Cover title={recordingTitle(recording(flow.id))}>
          <div className="flex flex-1 flex-col items-center justify-center gap-3">
            <Spinner className="size-8" />
            <p className="text-muted-foreground">Finding your note…</p>
          </div>
        </Cover>
      )
    case 'analysisFailed':
      return (
        <Cover title={recordingTitle(recording(flow.id))}>
          <AnalysisFailed id={flow.id} />
        </Cover>
      )
    case 'result': {
      const analyzed = recording(flow.id)
      if (!analyzed) return null
      const name = recordingName(analyzed)
      return (
        <Cover title={name} action={<ShareRecordingButton recording={analyzed} name={name} />}>
          <Result recording={analyzed} changes={flow.changes} trimFailed={flow.trimFailed} />
        </Cover>
      )
    }
  }
}

function recordingTitle(recording: Recording | undefined): string {
  return recording ? recordingName(recording) : ''
}

function GettingReady() {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-8 px-7 pb-24 text-center"
      data-testid="record-getting-ready"
    >
      <span
        aria-hidden
        className="relative grid size-50 place-items-center rounded-full border-[6px] border-muted-foreground/20"
      >
        <span className="absolute -inset-[6px] rounded-full border-[6px] border-transparent border-t-muted-foreground motion-safe:animate-spin" />
        <span className="size-41 rounded-full bg-muted-foreground/15" />
      </span>
      <output className="flex flex-col gap-2">
        <span className="text-3xl font-bold tracking-tight text-balance">
          Getting the mic ready…
        </span>
        <span className="text-lg text-muted-foreground">
          The screen turns red when it's recording.
        </span>
      </output>
    </div>
  )
}

function timerText(tenths: number): string {
  const seconds = Math.floor(tenths / 10)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}.${tenths % 10}`
}

function RecordingStep() {
  const { capture, liveTake, stopRecording } = useRecordFlow()
  const recording = capture.kind === 'recording'
  const startedAt = recording || capture.kind === 'finishing' ? capture.startedAt : null
  const stoppedAt = capture.kind === 'finishing' ? capture.stoppedAt : null
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!recording) return
    const timer = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(timer)
  }, [recording])
  const bars = useSyncExternalStore(liveTake.subscribe, liveTake.bars, liveTake.bars)
  const tenths = startedAt ? Math.max(0, Math.floor(((stoppedAt ?? now) - startedAt) / 100)) : 0

  return (
    <div
      className="flex flex-1 flex-col items-center px-5 pb-6"
      data-testid="recording-screen"
      data-state={capture.kind}
    >
      <p className="flex items-center gap-3.5 text-5xl font-extrabold tracking-tight">
        <span
          aria-hidden
          className={cn('size-5 rounded-full bg-current', recording && 'motion-safe:animate-pulse')}
        />
        Recording
      </p>
      <p
        className="mt-1.5 text-7xl font-semibold tracking-tight tabular-nums"
        data-testid="recording-timer"
      >
        {timerText(tenths)}
      </p>
      <LiveWaveform bars={bars} className="mt-8 h-44 w-full" />
      <output className="flex h-10 items-center font-medium" data-testid="recording-hint">
        {recording && capture.hearsNothing && "Can't hear anything. Move closer."}
      </output>
      <div className="mt-auto flex flex-col items-center gap-3 text-lg font-semibold">
        <Button
          variant="ghost"
          aria-label="Stop"
          data-testid="stop-button"
          data-state={recording ? 'recording' : 'finishing'}
          disabled={!recording}
          onClick={() => void stopRecording()}
          className="size-29 rounded-full bg-record-foreground p-0 ring-[9px] ring-record-foreground/30 hover:bg-record-foreground dark:hover:bg-record-foreground active:not-aria-[haspopup]:translate-y-0 active:scale-[0.97]"
        >
          <span aria-hidden className="size-10.5 rounded-[10px] bg-record-screen" />
        </Button>
        <span aria-hidden>Stop</span>
      </div>
    </div>
  )
}

function Review({ draft }: { draft: Draft }) {
  const { draftAnalysis, isSaving, saveDraft, closeFlow } = useRecordFlow()
  const { recordings } = useRecordings()
  const number = (recordings ?? []).reduce((highest, r) => Math.max(highest, r.number), 0) + 1
  const take: Recording = {
    id: 'draft',
    number,
    createdAt: 0,
    seconds: draft.seconds,
    sampleRate: draft.audio.sampleRate,
    waveform: draft.waveform,
    analysis: draftAnalysis ?? { state: 'analyzing' }
  }
  const review = useTakeReview(take)
  return (
    <>
      <TakeReview review={review} target="draft" audio={draft.audio} />
      <FlowButtons
        secondary={
          <FlowButton variant="secondary" onClick={closeFlow}>
            Discard
          </FlowButton>
        }
        primary={
          <FlowButton
            variant="primary"
            disabled={isSaving}
            onClick={() => void saveDraft(review.change())}
          >
            Save
          </FlowButton>
        }
      />
    </>
  )
}

function SaveFailed() {
  const { saveDraft, closeFlow } = useRecordFlow()
  return (
    <>
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CircleAlert />
          </EmptyMedia>
          <EmptyTitle>Couldn't save this Recording</EmptyTitle>
        </EmptyHeader>
      </Empty>
      <FlowButtons
        secondary={
          <FlowButton variant="secondary" onClick={closeFlow}>
            Discard
          </FlowButton>
        }
        primary={
          <FlowButton variant="primary" onClick={() => void saveDraft()}>
            Try again
          </FlowButton>
        }
      />
    </>
  )
}
