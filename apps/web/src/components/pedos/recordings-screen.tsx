'use client'

import { AudioLines, Play, Scissors, Square, Trash2 } from 'lucide-react'
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
import { noteName } from '@/lib/pitch'
import { formattedFartLength } from '@/lib/pitch-coverage'
import { loadAudio } from '@/lib/recording-store'
import {
  firstFartUsed,
  type Recording,
  recordingName,
  recordingPitch,
  replaySegment
} from '@/lib/recordings'
import { cn } from '@/lib/utils'
import { decodeWav } from '@/lib/wav'
import { waveformLevels } from '@/lib/waveform'
import { usePedos } from './pedos-provider'
import { Waveform } from './waveform'

/**
 * Every Recording, newest first, with its note and waveform, and how many notes you've
 * collected. Tap a row to play it. Matches the iPhone app's `RecordingsTab`.
 */
export function RecordingsScreen() {
  const pedos = usePedos()
  const [deleting, setDeleting] = useState<Recording | null>(null)

  // The page comes back on the Record tab, so the confirmation doesn't stay open.
  useEffect(() => {
    const visibilityChanged = () => {
      if (document.visibilityState === 'hidden') setDeleting(null)
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
                onDelete={() => setDeleting(recording)}
              />
            ))}
          </ul>
        </section>
      )}

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
 * A Recording: a big play button, its name, its note in a pill ("B3"), and the waveform of the
 * fart replay plays, without the silence around it, and the fart's length. Tap to play. Matches
 * `RecordingsRow`, plus the length, which the iPhone only reads out: it is what a locked Song's
 * "Needs a fart near F3 (3.0 s)" is measured against (#227).
 */
function RecordingRow({ recording, onDelete }: { recording: Recording; onDelete: () => void }) {
  const pedos = usePedos()
  const isPlaying = pedos.nowPlaying === recording.id
  const name = recordingName(recording)
  const levels = useReplayLevels(recording)

  return (
    <li
      className={cn('flex flex-col gap-2 py-3 pr-2 pl-4', isPlaying && 'bg-primary/10')}
      data-testid="recording-row"
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-3.5 rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-label={[name, ...describe(recording)].join(', ')}
          aria-pressed={isPlaying}
          onClick={() => pedos.togglePlayback(recording)}
        >
          <PlayCircle isPlaying={isPlaying} />
          <span className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="flex items-center justify-between gap-2">
              <span className="font-semibold">{name}</span>
              <Note recording={recording} />
            </span>
            <span className="flex items-center gap-2">
              <Waveform levels={levels} isPlaying={isPlaying} className="h-[30px] min-w-0 flex-1" />
              <span
                className="shrink-0 text-sm text-muted-foreground tabular-nums"
                data-testid="recording-length"
              >
                {formattedFartLength(recording)}
              </span>
            </span>
            {firstFartUsed(recording) && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Scissors className="size-3.5" aria-hidden />
                First fart used
              </span>
            )}
          </span>
        </button>
        <Button variant="ghost" size="icon" aria-label={`Delete ${name}`} onClick={onDelete}>
          <Trash2 />
        </Button>
      </div>
      <Status recording={recording} />
    </li>
  )
}

/** The row's play button: a tinted circle, filled while playing. */
function PlayCircle({ isPlaying }: { isPlaying: boolean }) {
  const Icon = isPlaying ? Square : Play
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-11 shrink-0 items-center justify-center rounded-full',
        isPlaying ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary'
      )}
    >
      <Icon className="size-4 fill-current" />
    </span>
  )
}

/** The note in a pill, or "noise-like". */
function Note({ recording }: { recording: Recording }) {
  if (recording.analysis.state !== 'analyzed') return null
  const pitch = recordingPitch(recording)
  if (pitch === null) {
    return (
      <span className="text-sm text-muted-foreground" data-testid="recording-note">
        noise-like
      </span>
    )
  }
  return (
    <span
      className="rounded-full bg-muted px-3 py-1 font-semibold tabular-nums"
      data-testid="recording-note"
    >
      {noteName(pitch)}
    </span>
  )
}

/** Analyzing, or not analyzed with Retry. */
function Status({ recording }: { recording: Recording }) {
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
      return null
  }
}

/** What the row's button says after the name: "1.1 s, B3, first fart used". */
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
      parts.push(pitch === null ? 'noise-like' : noteName(pitch))
      if (firstFartUsed(recording)) parts.push('first fart used')
    }
  }
  return parts
}

/** 48 loudness bars of what replay plays, drawn again when the analysis finds the fart. */
function useReplayLevels(recording: Recording): number[] {
  const [levels, setLevels] = useState<number[]>([])
  const segment = replaySegment(recording)
  const start = segment?.start
  const end = segment?.end
  const { id } = recording

  useEffect(() => {
    let current = true
    loadAudio(id)
      .then(wav => {
        const { samples, sampleRate } = decodeWav(wav)
        const from = start === undefined ? 0 : Math.max(0, Math.floor(start * sampleRate))
        const to = end === undefined ? samples.length : Math.floor(end * sampleRate)
        if (current) setLevels(waveformLevels(samples.subarray(from, to), 48))
      })
      .catch(() => {
        if (current) setLevels(Array(48).fill(0.05))
      })
    return () => {
      current = false
    }
  }, [id, start, end])

  return levels
}
