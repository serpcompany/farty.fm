'use client'

import {
  AudioWaveform,
  CircleAlert,
  CircleHelp,
  CirclePlay,
  CircleStop,
  LockOpen
} from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { type ReactNode, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Progress as CoverageBar } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { startAudioInTap } from '@/lib/audio/context'
import { noteName, pitchClass } from '@/lib/pitch'
import {
  type CoverageChanges,
  coverageFraction,
  coverageSummary,
  type SongRow
} from '@/lib/pitch-coverage'
import { formattedLength, type Recording, recordingName, recordingPitch } from '@/lib/recordings'
import { cn } from '@/lib/utils'
import { useAccount } from './account-provider'
import { type Draft, usePedos } from './pedos-provider'
import { PitchStrip } from './pitch-strip'
import { RecordButton } from './record-button'
import { Waveform } from './waveform'

/**
 * The full-screen cover over the tabs from the start of a take: Recording, then Review and
 * Result, with their error states. Matches the iPhone app's `RecordFlowView`.
 */
export function RecordFlow() {
  const pedos = usePedos()
  const { flow, capture } = pedos

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
    case 'analyzing': {
      const recording = pedos.recording(flow.id)
      return (
        <Cover title={recording ? recordingName(recording) : ''}>
          <div className="flex flex-1 flex-col items-center justify-center gap-3">
            <Spinner className="size-8" />
            <p className="text-muted-foreground">Finding your note…</p>
          </div>
        </Cover>
      )
    }
    case 'analysisFailed':
      return (
        <Cover title={recordingTitle(pedos.recording(flow.id))}>
          <AnalysisFailed id={flow.id} />
        </Cover>
      )
    case 'result': {
      const recording = pedos.recording(flow.id)
      if (!recording) return null
      return (
        <Cover title={recordingName(recording)}>
          <Result recording={recording} changes={flow.changes} />
        </Cover>
      )
    }
  }
}

function recordingTitle(recording: Recording | undefined): string {
  return recording ? recordingName(recording) : ''
}

/**
 * Full screen on a phone. From 768px, a card in the page under the top bar, which stays in view.
 */
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

/** Primary and secondary buttons pinned to the bottom of a flow step. */
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

/** Recording: the big button as Stop, with its pulse and the timer. */
function RecordingStep() {
  const pedos = usePedos()
  const startedAt = pedos.capture.kind === 'recording' ? pedos.capture.startedAt : null
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
        disabled={pedos.capture.kind !== 'recording'}
        onClick={() => void pedos.stopRecording()}
      />
      <p className="h-10 text-4xl tabular-nums" data-testid="recording-timer">
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
      </p>
    </div>
  )
}

/** Review: hear the take before keeping it. Save or Discard. */
function Review({ draft }: { draft: Draft }) {
  const pedos = usePedos()
  const isPlaying = pedos.nowPlaying === 'draft'
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
          onClick={() => pedos.togglePlayback('draft')}
        >
          {isPlaying ? <CircleStop strokeWidth={1.25} /> : <CirclePlay strokeWidth={1.25} />}
        </Button>
      </div>
      <FlowButtons
        secondary={
          <FlowButton variant="secondary" onClick={pedos.discardDraft}>
            Discard
          </FlowButton>
        }
        primary={
          <FlowButton
            variant="primary"
            disabled={pedos.isSaving}
            onClick={() => void pedos.saveDraft()}
          >
            Save
          </FlowButton>
        }
      />
    </>
  )
}

/** "Couldn't save this Recording", with Try again and Discard. */
function SaveFailed() {
  const pedos = usePedos()
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
          <FlowButton variant="secondary" onClick={pedos.discardDraft}>
            Discard
          </FlowButton>
        }
        primary={
          <FlowButton variant="primary" onClick={() => void pedos.saveDraft()}>
            Try again
          </FlowButton>
        }
      />
    </>
  )
}

/** A path without its trailing slash, so `/recordings/` and `/recordings` match. */
const route = (path: string) => path.replace(/\/$/, '') || '/'

/**
 * Closes the flow and goes to `href`. Going to another page, the flow stays open until that page
 * shows: closed first, it would show the Record screen idle on the way out, and that screen opens
 * the microphone.
 */
function useFinishFlow(): (href: string) => void {
  const { finishFlow } = usePedos()
  const router = useRouter()
  const pathname = usePathname()
  const [leaving, setLeaving] = useState<string | null>(null)
  useEffect(() => {
    if (leaving !== null && route(pathname) !== leaving) finishFlow()
  }, [finishFlow, leaving, pathname])
  return href => {
    if (route(href) === route(pathname)) {
      finishFlow()
      return
    }
    setLeaving(route(pathname))
    router.push(href)
  }
}

/** "Saved, but we couldn't find its note", with Retry. The Recording stays listed. */
function AnalysisFailed({ id }: { id: string }) {
  const pedos = usePedos()
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
          <FlowButton variant="primary" onClick={() => void pedos.retryAnalysis(id)}>
            Retry
          </FlowButton>
        }
      />
    </>
  )
}

/**
 * Result: the note you just made, and what it unlocked. Matches the iPhone app's `ResultView`. The
 * first time, each button opens the account step before it goes where it was tapped (#155).
 */
function Result({ recording, changes }: { recording: Recording; changes: CoverageChanges }) {
  const pedos = usePedos()
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
              collected={pedos.collectedPitchClasses}
              outlined={pitchClass(pitch)}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <AudioWaveform className="size-16 text-muted-foreground" aria-hidden />
            <p className="text-2xl font-bold" data-testid="result-noise">
              No steady note this time
            </p>
            <p className="text-muted-foreground">
              It's saved. On the Recordings tab you can place it on a note by ear.
            </p>
          </div>
        )}
        <Progress changes={changes} hasMelodicRecordings={pedos.melodicRecordings.length > 0} />
      </div>
      {/* After an unlock, Try it opens the first Song unlocked in Song Creator. */}
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
                // Song Creator plays the Toot once it's made: the tap starts the sound it needs.
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

/** Unlocks, then Pitch Coverage that went up, or else the Song closest to unlocking. */
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

/** A Song's Pitch Coverage: its title, a bar, and "3 of 4 notes covered". */
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
