'use client'

import { AudioLines, ChevronRight, Ear, Scissors, Trash2 } from 'lucide-react'
import { useState } from 'react'
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
import { noteName } from '@/lib/pitch'
import { formattedFartLength } from '@/lib/pitch-coverage'
import {
  firstFartUsed,
  isNoiseLike,
  placedPitch,
  type Recording,
  recordingName,
  recordingPitch
} from '@/lib/recordings'
import { cn } from '@/lib/utils'
import { usePageHidden } from './page-hidden'
import { PlaceByEar } from './place-by-ear'
import { recordingSound, usePlayback } from './playback-provider'
import { useRecordFlow } from './record-flow-provider'
import { PlayCircle, useReplayLevels } from './recording-replay'
import { useRecordings } from './recordings-provider'
import { Waveform } from './waveform'

export function RecordingsScreen() {
  const { recordings, melodicRecordings, collectedNotes, deleteRecording } = useRecordings()
  const [deleting, setDeleting] = useState<Recording | null>(null)
  const [placing, setPlacing] = useState<string | null>(null)
  usePageHidden(() => {
    setDeleting(null)
    setPlacing(null)
  })

  if (recordings === null) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    )
  }

  const count = recordings.length
  return (
    <div className="flex flex-1 flex-col px-4 pb-6">
      <h1 className="pt-4 pb-3 text-3xl font-bold tracking-tight">Recordings</h1>
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
          <h2
            id="pitch-summary"
            className="flex flex-wrap justify-between gap-x-4 px-4 pb-1.5 text-xs font-normal text-muted-foreground"
            data-testid="pitch-summary"
          >
            <span>
              {counted(melodicRecordings.length, 'Melodic Recording')} across{' '}
              {counted(collectedNotes.size, 'note')}
            </span>
            <span>{counted(count, 'Recording')}</span>
          </h2>
          <ul
            className="divide-y overflow-hidden rounded-xl bg-muted/60"
            data-testid="recordings-list"
          >
            {[...recordings].reverse().map(recording => (
              <RecordingRow
                key={recording.id}
                recording={recording}
                onPlace={() => setPlacing(recording.id)}
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
                if (deleting) void deleteRecording(deleting.id)
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

function counted(number: number, noun: string): string {
  return `${number} ${noun}${number === 1 ? '' : 's'}`
}

function RecordingRow({
  recording,
  onPlace,
  onDelete
}: {
  recording: Recording
  onPlace: () => void
  onDelete: () => void
}) {
  const { nowPlaying, togglePlayback } = usePlayback()
  const isPlaying = nowPlaying === recording.id
  const name = recordingName(recording)
  const levels = useReplayLevels(recording)
  const pitch = recordingPitch(recording)
  const placed = placedPitch(recording)
  const noiseLike = isNoiseLike(recording)

  return (
    <li
      className={cn('flex flex-col gap-2 py-3 pr-2 pl-4', isPlaying && 'bg-primary/10')}
      data-testid="recording-row"
    >
      <div className="flex items-center gap-1">
        <div className="relative min-w-0 flex-1">
          <button
            type="button"
            className="flex w-full items-center gap-3.5 rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            aria-label={[name, ...describe(recording)].join(', ')}
            aria-pressed={isPlaying}
            onClick={() => togglePlayback(recordingSound(recording))}
          >
            <PlayCircle isPlaying={isPlaying} />
            <span className="flex min-w-0 flex-1 flex-col gap-2">
              <span
                className={cn(
                  'flex h-8 items-center justify-between gap-2',
                  noiseLike && (placed === null ? 'pr-28' : 'pr-20')
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
                <Waveform
                  levels={levels}
                  isPlaying={isPlaying}
                  className="h-[30px] min-w-0 flex-1"
                />
                <span
                  className="shrink-0 text-sm text-muted-foreground tabular-nums"
                  data-testid="recording-length"
                >
                  {formattedFartLength(recording)}
                </span>
              </span>
              {placed !== null && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Ear className="size-3.5" aria-hidden />
                  Placed by ear
                </span>
              )}
              {firstFartUsed(recording) && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Scissors className="size-3.5" aria-hidden />
                  First fart used
                </span>
              )}
            </span>
          </button>
          {noiseLike && (
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
      <Status recording={recording} />
    </li>
  )
}

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

function Status({ recording }: { recording: Recording }) {
  const { retryAnalysis } = useRecordFlow()
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
            onClick={() => void retryAnalysis(recording.id)}
          >
            Retry
          </Button>
        </div>
      )
    case 'analyzed':
      return null
  }
}

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
      if (pitch !== null) parts.push(noteName(pitch))
      else if (placed !== null) parts.push(noteName(placed), 'placed by ear')
      else parts.push('noise-like')
      if (firstFartUsed(recording)) parts.push('first fart used')
    }
  }
  return parts
}
