'use client'

import {
  AudioWaveform,
  CircleAlert,
  CircleHelp,
  CirclePlay,
  CircleStop,
  LockOpen,
  Scissors
} from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Progress as CoverageBar } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { startAudioInTap } from '@/lib/audio/context'
import { forgetDecoded } from '@/lib/audio/player'
import { noteName, pitchClass } from '@/lib/pitch'
import {
  type CoverageChanges,
  coverageFraction,
  coverageSummary,
  type SongRow
} from '@/lib/pitch-coverage'
import {
  firstFartUsed,
  formattedLength,
  type Recording,
  recordingName,
  recordingPitch
} from '@/lib/recordings'
import { cn } from '@/lib/utils'
import { encodeWav, type PcmAudio } from '@/lib/wav'
import { useAccount } from './account-provider'
import { PitchStrip } from './pitch-strip'
import { type Sound, usePlayback } from './playback-provider'
import { RecordButton } from './record-button'
import { type Draft, useRecordFlow } from './record-flow-provider'
import { useRecordings } from './recordings-provider'
import { Waveform } from './waveform'

export function RecordFlow() {
  const { flow, capture } = useRecordFlow()
  const { recording } = useRecordings()

  if (!flow && (capture.kind === 'recording' || capture.kind === 'finishing')) {
    return (
      <Cover>
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
      return (
        <Cover title={recordingName(analyzed)}>
          <Result recording={analyzed} changes={flow.changes} />
        </Cover>
      )
    }
  }
}

function recordingTitle(recording: Recording | undefined): string {
  return recording ? recordingName(recording) : ''
}

function Cover({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="contents md:fixed md:inset-x-0 md:top-[calc(4rem+1px)] md:bottom-0 md:z-40 md:flex md:items-center md:justify-center md:bg-background md:p-6">
      <div
        role="dialog"
        aria-modal
        aria-label={title ?? 'Recording'}
        className="fixed inset-0 z-40 flex flex-col bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] md:static md:h-full md:max-h-[44rem] md:w-full md:max-w-md md:rounded-3xl md:border md:py-3 md:shadow-sm"
      >
        <header className="flex h-12 shrink-0 items-center justify-center px-4">
          {title && <h1 className="font-semibold">{title}</h1>}
        </header>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col md:min-h-0">{children}</div>
      </div>
    </div>
  )
}

function FlowButtons({ secondary, primary }: { secondary?: ReactNode; primary: ReactNode }) {
  return (
    <div className={cn('grid gap-3 px-5 pb-3', secondary && 'grid-cols-2')}>
      {secondary}
      {primary}
    </div>
  )
}

function FlowButton({
  variant,
  onClick,
  disabled,
  children
}: {
  variant: 'primary' | 'secondary'
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <Button
      size="lg"
      variant={variant === 'primary' ? 'default' : 'secondary'}
      className="h-12 text-base"
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </Button>
  )
}

function RecordingStep() {
  const { capture, stopRecording } = useRecordFlow()
  const startedAt = capture.kind === 'recording' ? capture.startedAt : null
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [])
  const seconds = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-7">
      <div className="h-10" />
      <RecordButton
        isRecording
        disabled={capture.kind !== 'recording'}
        onClick={() => void stopRecording()}
      />
      <p className="h-10 text-4xl tabular-nums" data-testid="recording-timer">
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
      </p>
    </div>
  )
}

function useDraftSound(audio: PcmAudio): Sound {
  const sound = useMemo(
    (): Sound => ({
      key: 'draft',
      decodeKey: `draft-${crypto.randomUUID()}`,
      wav: async () => encodeWav(audio),
      segment: null
    }),
    [audio]
  )
  useEffect(() => () => forgetDecoded(sound.decodeKey), [sound])
  return sound
}

function Review({ draft }: { draft: Draft }) {
  const { isSaving, saveDraft, closeFlow } = useRecordFlow()
  const { nowPlaying, togglePlayback } = usePlayback()
  const sound = useDraftSound(draft.audio)
  const isPlaying = nowPlaying === 'draft'
  return (
    <>
      <div className="flex flex-1 flex-col items-center justify-center gap-7 px-6">
        <Waveform levels={draft.waveform} isPlaying={isPlaying} className="h-24 w-full" />
        <p className="text-2xl text-muted-foreground tabular-nums">
          {formattedLength(draft.seconds)}
        </p>
        <Button
          variant="ghost"
          aria-label={isPlaying ? 'Stop' : 'Play'}
          data-testid="review-play"
          className="size-20 rounded-full p-0 [&_svg:not([class*='size-'])]:size-18"
          onClick={() => togglePlayback(sound)}
        >
          {isPlaying ? <CircleStop strokeWidth={1.25} /> : <CirclePlay strokeWidth={1.25} />}
        </Button>
      </div>
      <FlowButtons
        secondary={
          <FlowButton variant="secondary" onClick={closeFlow}>
            Discard
          </FlowButton>
        }
        primary={
          <FlowButton variant="primary" disabled={isSaving} onClick={() => void saveDraft()}>
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

const route = (path: string) => path.replace(/\/$/, '') || '/'

function useFinishFlow(): (href: string) => void {
  const { closeFlow } = useRecordFlow()
  const router = useRouter()
  const pathname = usePathname()
  const [leaving, setLeaving] = useState<string | null>(null)
  useEffect(() => {
    if (leaving !== null && route(pathname) !== leaving) closeFlow()
  }, [closeFlow, leaving, pathname])
  return href => {
    if (route(href) === route(pathname)) {
      closeFlow()
      return
    }
    setLeaving(route(pathname))
    router.push(href)
  }
}

function AnalysisFailed({ id }: { id: string }) {
  const { retryAnalysis } = useRecordFlow()
  const finish = useFinishFlow()
  return (
    <>
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CircleHelp />
          </EmptyMedia>
          <EmptyTitle>Saved, but we couldn't find its note</EmptyTitle>
          <EmptyDescription>It's on the Recordings tab as not analyzed.</EmptyDescription>
        </EmptyHeader>
      </Empty>
      <FlowButtons
        secondary={
          <FlowButton variant="secondary" onClick={() => finish('/recordings/')}>
            Done
          </FlowButton>
        }
        primary={
          <FlowButton variant="primary" onClick={() => void retryAnalysis(id)}>
            Retry
          </FlowButton>
        }
      />
    </>
  )
}

function Result({ recording, changes }: { recording: Recording; changes: CoverageChanges }) {
  const { collectedPitchClasses, melodicRecordings } = useRecordings()
  const finish = useFinishFlow()
  const { offerStep } = useAccount()
  const go = (href: string) => offerStep(() => finish(href))
  const pitch = recordingPitch(recording)

  return (
    <>
      <div className="flex flex-1 flex-col items-center gap-7 overflow-y-auto p-5 text-center">
        {pitch !== null ? (
          <div className="flex w-full flex-col items-center gap-1">
            <p className="font-semibold text-muted-foreground">Your note</p>
            <p className="text-8xl font-bold tracking-tight" data-testid="result-note">
              {noteName(pitch)}
            </p>
            <PitchStrip
              className="w-full pt-3"
              collected={collectedPitchClasses}
              outlined={pitchClass(pitch)}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <AudioWaveform className="size-16 text-muted-foreground" aria-hidden />
            <p className="text-2xl font-bold" data-testid="result-noise">
              No steady note this time
            </p>
            <p className="text-muted-foreground">It's saved, but it can't play melody notes.</p>
          </div>
        )}
        {firstFartUsed(recording) && (
          <div className="space-y-1">
            <p className="flex items-center justify-center gap-2 font-semibold">
              <Scissors className="size-4" aria-hidden />
              We kept the first fart
            </p>
            <p className="text-sm text-muted-foreground">We heard more than one.</p>
          </div>
        )}
        <Progress changes={changes} hasMelodicRecordings={melodicRecordings.length > 0} />
      </div>
      {changes.unlocked.length > 0 ? (
        <FlowButtons
          secondary={
            <FlowButton variant="secondary" onClick={() => go('/recordings/')}>
              Done
            </FlowButton>
          }
          primary={
            <FlowButton
              variant="primary"
              onClick={() => {
                startAudioInTap()
                go(`/compose/${changes.unlocked[0].id}/`)
              }}
            >
              Try it
            </FlowButton>
          }
        />
      ) : (
        <FlowButtons
          secondary={
            <FlowButton variant="secondary" onClick={() => go('/')}>
              Record another
            </FlowButton>
          }
          primary={
            <FlowButton variant="primary" onClick={() => go('/recordings/')}>
              Done
            </FlowButton>
          }
        />
      )}
    </>
  )
}

function Progress({
  changes,
  hasMelodicRecordings
}: {
  changes: CoverageChanges
  hasMelodicRecordings: boolean
}) {
  const { unlocked, improved, closest } = changes
  const showsClosest =
    unlocked.length === 0 && improved.length === 0 && closest !== null && hasMelodicRecordings
  if (unlocked.length === 0 && improved.length === 0 && !showsClosest) return null
  return (
    <div className="flex w-full flex-col gap-3 text-left" data-testid="result-progress">
      {unlocked.length > 2 ? (
        <Box>
          <Unlocked>You unlocked {unlocked.length} Songs</Unlocked>
          <p className="pt-1 text-muted-foreground">{unlocked.map(s => s.title).join(' · ')}</p>
        </Box>
      ) : (
        unlocked.map(song => (
          <Box key={song.id}>
            <Unlocked>You unlocked {song.title}</Unlocked>
          </Box>
        ))
      )}
      {improved.slice(0, 2).map(row => (
        <CoverageCard key={row.song.id} row={row} />
      ))}
      {showsClosest && closest && <CoverageCard row={closest} />}
    </div>
  )
}

function Box({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl bg-muted/60 p-4" data-testid="result-card">
      {children}
    </div>
  )
}

function Unlocked({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 font-semibold">
      <LockOpen className="size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

function CoverageCard({ row }: { row: SongRow }) {
  return (
    <Box>
      <div className="flex flex-col gap-1.5">
        <p className="font-semibold">{row.song.title}</p>
        <CoverageBar value={coverageFraction(row.coverage) * 100} aria-hidden />
        <p className="text-sm text-muted-foreground">{coverageSummary(row.coverage)}</p>
      </div>
    </Box>
  )
}
