'use client'

import { AudioWaveform, CircleAlert, CircleHelp, LockOpen } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react'
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
import { type Recording, recordingName, songPitch } from '@/lib/recordings'
import { cn } from '@/lib/utils'
import { useAccount } from './account-provider'
import { type Draft, usePedos } from './pedos-provider'
import { PitchStrip } from './pitch-strip'
import { useTake } from './recording-replay'
import { TakeReview, useTakeReview } from './take-review'
import { LiveWaveform } from './waveform'

/**
 * The full-screen cover over the tabs from the tap on Record: getting the mic ready, Recording,
 * then Review and Result, with their error states. Matches the iPhone app's `RecordFlowView`.
 */
export function RecordFlow() {
  const pedos = usePedos()
  const { flow, capture } = pedos

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

/** A cover's dialog always has a name: its shown `title`, or else a `label` for screen readers. */
type CoverName = { title: string; label?: never } | { title?: never; label: string }

/**
 * Full screen on a phone. From 768px, a card in the page under the top bar, which stays in view.
 * `tone="record"`: the whole cover red, while Record records (#314).
 */
function Cover({
  title,
  label,
  tone,
  children
}: CoverName & {
  tone?: 'record'
  children: ReactNode
}) {
  return (
    <div className="contents md:fixed md:inset-x-0 md:top-[calc(4rem+1px)] md:bottom-0 md:z-40 md:flex md:items-center md:justify-center md:bg-background md:p-6">
      <div
        role="dialog"
        aria-modal
        aria-label={title ?? label}
        className={cn(
          'fixed inset-0 z-40 flex flex-col bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] md:static md:h-full md:max-h-[44rem] md:w-full md:max-w-md md:rounded-3xl md:border md:py-3 md:shadow-sm',
          tone === 'record' && 'bg-record-screen text-record-foreground md:border-transparent'
        )}
      >
        <header className="flex h-12 shrink-0 items-center justify-center px-4">
          {title && <h1 className="font-semibold">{title}</h1>}
        </header>
        <div className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col">{children}</div>
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

/**
 * Getting the mic ready (#314): grey, with a ring spinning where the Record button was, from the
 * tap until the take's audio comes in. Never red before then.
 */
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

/** A take's length so far, to the tenth: "0:03.4". */
function timerText(tenths: number): string {
  const seconds = Math.floor(tenths / 10)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}.${tenths % 10}`
}

/**
 * Recording (#314): the whole screen red from the moment the take's audio comes in, with a large
 * "Recording", a timer counting tenths, the take's waveform drawing live, and Stop. "Can't hear
 * anything" shows under the waveform while the take so far is one Stop would refuse (#281).
 * Finishing after Stop, Stop dims and the timer and waveform hold.
 */
function RecordingStep() {
  const pedos = usePedos()
  const { capture, liveTake } = pedos
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
          onClick={() => void pedos.stopRecording()}
          className="size-29 rounded-full bg-record-foreground p-0 ring-[9px] ring-record-foreground/30 hover:bg-record-foreground dark:hover:bg-record-foreground active:not-aria-[haspopup]:translate-y-0 active:scale-[0.97]"
        >
          <span aria-hidden className="size-10.5 rounded-[10px] bg-record-screen" />
        </Button>
        <span aria-hidden>Stop</span>
      </div>
    </div>
  )
}

/**
 * Review (#314): the take's review, as soon as Stop finishes, while analysis finds its note. Save
 * keeps it at once, with what the review changed (ADR 0002); Discard throws it away.
 */
function Review({ draft }: { draft: Draft }) {
  const pedos = usePedos()
  // The take as the Recording it will be: numbered after the last, analyzed as far as it's got.
  const number = (pedos.recordings ?? []).reduce((highest, r) => Math.max(highest, r.number), 0) + 1
  const take: Recording = {
    id: 'draft',
    number,
    createdAt: 0,
    seconds: draft.seconds,
    sampleRate: draft.audio.sampleRate,
    waveform: draft.waveform,
    analysis: pedos.draftAnalysis ?? { state: 'analyzing' }
  }
  const review = useTakeReview(take)
  return (
    <>
      <TakeReview review={review} target="draft" audio={draft.audio} />
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
            onClick={() => void pedos.saveDraft(review.change())}
          >
            Save
          </FlowButton>
        }
      />
    </>
  )
}

/**
 * A saved Recording's review, from the pencil on its row (#314): the same screen as after Stop,
 * with Cancel and Save. Save changes only what the user changed, and waits only to find the fart
 * between moved handles (ADR 0019).
 */
export function RecordingReview({
  recording,
  onClose
}: {
  recording: Recording
  onClose: () => void
}) {
  const pedos = usePedos()
  const review = useTakeReview(recording)
  const audio = useTake(recording)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const close = () => {
    if (pedos.nowPlaying === recording.id) pedos.stopPlayback()
    onClose()
  }
  const save = async () => {
    const change = review.change()
    // The note and the name save at once.
    if (change.handles === undefined) {
      if (Object.keys(change).length > 0) void pedos.placeRecording(recording.id, change)
      close()
      return
    }
    setSaving(true)
    setFailed(false)
    const saved = await pedos.placeRecording(recording.id, change)
    setSaving(false)
    if (saved) close()
    else setFailed(true)
  }
  return (
    <Cover title={recordingName({ number: recording.number, name: review.name })}>
      <TakeReview review={review} target={recording} audio={audio} />
      {failed && (
        <p role="alert" className="px-5 pb-2 text-sm text-destructive">
          Couldn't save the trim. Try again.
        </p>
      )}
      <FlowButtons
        secondary={
          <FlowButton variant="secondary" onClick={close}>
            Cancel
          </FlowButton>
        }
        primary={
          <FlowButton variant="primary" disabled={saving} onClick={() => void save()}>
            Save
          </FlowButton>
        }
      />
    </Cover>
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
  const pitch = songPitch(recording)

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
            <p className="text-2xl font-bold" data-testid="result-no-note">
              No note
            </p>
            <p className="text-muted-foreground">
              It's saved. Songs leave it out until you give it a note from the Recordings tab.
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
