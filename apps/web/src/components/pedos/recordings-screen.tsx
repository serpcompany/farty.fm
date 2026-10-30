'use client'

import { AudioLines, ChevronRight, Ear, Scissors, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'
import { canRescan, rescanSummary } from '@/lib/analysis-upgrade'
import { noteName } from '@/lib/pitch'
import { formattedFartLength } from '@/lib/pitch-coverage'
import {
  isNoiseLike,
  placedPitch,
  playedPart,
  type Recording,
  recordingName,
  recordingPitch,
  trimOf
} from '@/lib/recordings'
import { cn } from '@/lib/utils'
import { usePedos } from './pedos-provider'
import { PlaceByEar } from './place-by-ear'
import { PlayCircle, useReplayLevels } from './recording-replay'
import { ReplayWaveform } from './waveform'

/**
 * Every Recording, newest first, with its note and waveform, and how many notes you've
 * collected. Tap a row to play it. Matches the iPhone app's `RecordingsTab`, plus placing a
 * Noise-like Recording on a note by ear (ADR 0015) and re-scanning one with no note, or all of
 * them (#282), which the web app alone has.
 */
export function RecordingsScreen() {
  const pedos = usePedos()
  const [deleting, setDeleting] = useState<Recording | null>(null)
  const [placing, setPlacing] = useState<string | null>(null)
  // The last Re-scan's result goes into the live region after it opens, so a result that came
  // while the tab was closed is announced when the user comes back, not only shown.
  const [opened, setOpened] = useState(false)
  useEffect(() => setOpened(true), [])

  // The page comes back on the Record tab, so the confirmation and the picker don't stay open.
  useEffect(() => {
    const visibilityChanged = () => {
      if (document.visibilityState === 'hidden') {
        setDeleting(null)
        setPlacing(null)
      }
    }
    document.addEventListener('visibilitychange', visibilityChanged)
    return () => document.removeEventListener('visibilitychange', visibilityChanged)
  }, [])

  if (pedos.recordings === null) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    )
  }

  const count = pedos.recordings.length
  const noNote = pedos.recordings.filter(canRescan).length
  const { rescanning, rescanned } = pedos
  return (
    <div className="flex flex-1 flex-col px-4 pb-6">
      <div className="flex items-center justify-between gap-2 pt-4 pb-3">
        <h1 className="text-3xl font-bold tracking-tight">Recordings</h1>
        {(noNote > 0 || rescanning !== null) && (
          <Button
            variant="ghost"
            className="h-11 text-base text-primary"
            disabled={rescanning !== null}
            onClick={() => void pedos.rescanAll()}
          >
            Re-scan all
          </Button>
        )}
      </div>
      {/* Re-scan's progress, then what it changed. */}
      <div aria-live="polite" data-testid="rescan-status">
        {rescanning !== null && rescanning.total > 1 ? (
          <p className="flex items-center gap-2 px-4 pb-3 text-sm text-muted-foreground">
            <Spinner aria-hidden />
            Re-scanning {rescanning.done + 1} of {rescanning.total}
          </p>
        ) : (
          opened &&
          rescanned !== null &&
          rescanning === null && <p className="px-4 pb-3 text-sm">{rescanSummary(rescanned)}</p>
        )}
      </div>
      {count === 0 ? (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <AudioLines />
            </EmptyMedia>
            <EmptyTitle>No Recordings yet</EmptyTitle>
            <EmptyDescription>Go to the Record tab and tap the red button.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <section aria-labelledby="pitch-summary">
          {/* Side by side when they fit; stacked at large text sizes. */}
          <h2
            id="pitch-summary"
            className="flex flex-wrap justify-between gap-x-4 px-4 pb-1.5 text-xs font-normal text-muted-foreground"
            data-testid="pitch-summary"
          >
            <span>
              {counted(pedos.melodicRecordings.length, 'Melodic Recording')} across{' '}
              {counted(pedos.collectedNotes.size, 'note')}
            </span>
            <span>{counted(count, 'Recording')}</span>
          </h2>
          <ul
            className="divide-y overflow-hidden rounded-xl bg-muted/60"
            data-testid="recordings-list"
          >
            {[...pedos.recordings].reverse().map(recording => (
              <RecordingRow
                key={recording.id}
                recording={recording}
                onPlace={() => setPlacing(recording.id)}
                onRescan={() => void pedos.rescanRecording(recording.id)}
                onDelete={() => setDeleting(recording)}
              />
            ))}
          </ul>
        </section>
      )}

      <PlaceByEar recordingId={placing} onClose={() => setPlacing(null)} />

      <AlertDialog open={deleting !== null} onOpenChange={open => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting && recordingName(deleting)}?</AlertDialogTitle>
            <AlertDialogDescription>This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleting) void pedos.deleteRecording(deleting.id)
                setDeleting(null)
              }}
            >
              Delete Recording
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** "1 Recording", "9 Melodic Recordings". */
function counted(number: number, noun: string): string {
  return `${number} ${noun}${number === 1 ? '' : 's'}`
}

/**
 * A Recording: a big play button, its name, its note in a pill ("B3"), the waveform of what replay
 * plays, and the fart's length. Tap the row to play the whole take (ADR 0016), or its Trim when
 * it has one (ADR 0019); tap or drag the waveform to play from a spot (#293). Matches
 * `RecordingsRow`, plus the length, which the iPhone only reads out: it is what a locked Song's
 * "Needs a fart near F3 (3.0 s)" is measured against (#227).
 */
function RecordingRow({
  recording,
  onPlace,
  onRescan,
  onDelete
}: {
  recording: Recording
  /** Opens the place-by-ear picker, for a Noise-like or placed Recording. */
  onPlace: () => void
  /** Re-scans it, for a Recording with no note. */
  onRescan: () => void
  onDelete: () => void
}) {
  const pedos = usePedos()
  const isPlaying = pedos.nowPlaying === recording.id
  const name = recordingName(recording)
  const part = playedPart(recording)
  const levels = useReplayLevels(recording, part)
  const placed = placedPitch(recording)
  // A Placed Pitch stays in use when a new analysis finds a Recording Pitch (ADR 0017).
  const placeable = placed !== null || isNoiseLike(recording)
  const pitch = placed === null ? recordingPitch(recording) : null
  const trimmed = trimOf(recording) !== null

  return (
    <li
      className={cn('flex flex-col gap-2 py-3 pr-2 pl-4', isPlaying && 'bg-primary/10')}
      data-testid="recording-row"
    >
      <div className="flex items-center gap-1">
        {/* The row's play button lies under it all; the waveform and a Noise-like or placed
            Recording's note take their own taps. */}
        <div className="relative flex min-w-0 flex-1 items-center gap-3.5">
          <button
            type="button"
            className="absolute inset-0 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            aria-label={[name, ...describe(recording)].join(', ')}
            aria-pressed={isPlaying}
            onClick={() => pedos.togglePlayback(recording)}
          />
          <span className="pointer-events-none relative">
            <PlayCircle isPlaying={isPlaying} />
          </span>
          <span className="pointer-events-none relative flex min-w-0 flex-1 flex-col gap-2">
            <span
              className={cn(
                'flex h-8 items-center justify-between gap-2',
                placeable && (placed === null ? 'pr-28' : 'pr-20')
              )}
            >
              <span className="truncate font-semibold">{name}</span>
              {pitch !== null && (
                <span
                  className="rounded-full bg-muted px-3 py-1 font-semibold tabular-nums"
                  data-testid="recording-note"
                >
                  {noteName(pitch)}
                </span>
              )}
            </span>
            <span className="flex items-center gap-2">
              <ReplayWaveform
                levels={levels}
                view={part}
                playing={isPlaying ? pedos.playingPart : null}
                position={pedos.playbackPosition}
                label={`Play ${name} from a spot`}
                onScrubStart={pedos.stopPlayback}
                onPlayFrom={seconds => {
                  if (part.endSeconds - seconds >= 0.02)
                    pedos.playRecording(recording, {
                      startSeconds: seconds,
                      endSeconds: part.endSeconds
                    })
                }}
                className="pointer-events-auto h-[30px] flex-1"
              />
              <span
                className="shrink-0 text-sm text-muted-foreground tabular-nums"
                data-testid="recording-length"
              >
                {formattedFartLength(recording)}
              </span>
            </span>
            {(placed !== null || trimmed) && (
              <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                {placed !== null && (
                  <span className="inline-flex items-center gap-1">
                    <Ear className="size-3.5" aria-hidden />
                    Placed by ear
                  </span>
                )}
                {placed !== null && trimmed && <span aria-hidden>·</span>}
                {trimmed && (
                  <span className="inline-flex items-center gap-1">
                    <Scissors className="size-3.5" aria-hidden />
                    Trimmed
                  </span>
                )}
              </span>
            )}
          </span>
          {placeable && (
            <PlaceButton
              name={name}
              placed={placed}
              onClick={onPlace}
              className="absolute top-0 right-0"
            />
          )}
        </div>
        <Button variant="ghost" size="icon" aria-label={`Delete ${name}`} onClick={onDelete}>
          <Trash2 />
        </Button>
      </div>
      <Status recording={recording} onRescan={onRescan} />
    </li>
  )
}

/**
 * A Noise-like or placed Recording's note, which opens the place-by-ear picker: "noise-like ›"
 * until it's placed, then the note it's placed on in a dashed pill (ADR 0015).
 */
function PlaceButton({
  name,
  placed,
  onClick,
  className
}: {
  name: string
  placed: number | null
  onClick: () => void
  className?: string
}) {
  if (placed === null) {
    return (
      <Button
        variant="outline"
        aria-haspopup="dialog"
        aria-label={`${name} is noise-like. Place it on a note`}
        onClick={onClick}
        className={cn('gap-1 rounded-full pr-2 pl-3 font-normal text-muted-foreground', className)}
        data-testid="recording-note"
      >
        noise-like
        <ChevronRight />
      </Button>
    )
  }
  return (
    <Button
      variant="ghost"
      aria-haspopup="dialog"
      aria-label={`${noteName(placed)}, placed by ear. Move it or take it off`}
      onClick={onClick}
      className={cn(
        'rounded-full border-[1.5px] border-dashed border-foreground/45 px-3 text-base font-semibold tabular-nums',
        className
      )}
      data-testid="recording-note"
    >
      {noteName(placed)}
    </Button>
  )
}

/** Analyzing, not analyzed with Retry, or with no note and Re-scan (#282). */
function Status({ recording, onRescan }: { recording: Recording; onRescan: () => void }) {
  const pedos = usePedos()
  // Lines up with the name, past the play button.
  const indent = 'pl-[3.625rem]'
  switch (recording.analysis.state) {
    case 'analyzing':
      return (
        <div className={indent}>
          <Spinner aria-label="Analyzing" data-testid={`analyzing-${recording.number}`} />
        </div>
      )
    case 'notAnalyzed':
      return (
        <div className={cn('flex items-center gap-2.5', indent)}>
          <span className="text-sm text-muted-foreground">not analyzed</span>
          <Button
            variant="outline"
            size="sm"
            aria-label={`Retry analyzing ${recordingName(recording)}`}
            onClick={() => void pedos.retryAnalysis(recording.id)}
          >
            Retry
          </Button>
        </div>
      )
    case 'analyzed':
      if (!canRescan(recording)) return null
      return (
        <div className={indent}>
          {pedos.rescanning?.recordingId === recording.id ? (
            <Spinner aria-label="Re-scanning" data-testid={`rescanning-${recording.number}`} />
          ) : (
            <Button
              variant="outline"
              size="sm"
              aria-label={`Re-scan ${recordingName(recording)}`}
              disabled={pedos.rescanning !== null}
              onClick={onRescan}
            >
              Re-scan
            </Button>
          )}
        </div>
      )
  }
}

/**
 * What the row's button says after the name: "1.1 s, B3", "0.9 s, C3, placed by ear", or
 * "0.4 s, noise-like, trimmed".
 */
function describe(recording: Recording): string[] {
  const parts = [formattedFartLength(recording)]
  switch (recording.analysis.state) {
    case 'analyzing':
      parts.push('analyzing')
      break
    case 'notAnalyzed':
      parts.push('not analyzed')
      break
    case 'analyzed': {
      const pitch = recordingPitch(recording)
      const placed = placedPitch(recording)
      if (placed !== null) parts.push(noteName(placed), 'placed by ear')
      else if (pitch !== null) parts.push(noteName(pitch))
      else parts.push('noise-like')
      if (trimOf(recording)) parts.push('trimmed')
    }
  }
  return parts
}
