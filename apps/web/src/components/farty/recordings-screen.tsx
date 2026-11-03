'use client'

import { AudioLines, Ear, Pencil, Scissors, Trash2 } from 'lucide-react'
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
import { playbackPosition, stopPlayback } from '@/lib/audio/player'
import { noteName } from '@/lib/pitch'
import { formattedFartLength } from '@/lib/pitch-coverage'
import {
  placedPitch,
  playedPart,
  type Recording,
  recordingName,
  songPitch,
  trimOf
} from '@/lib/recordings'
import { cn } from '@/lib/utils'
import { AccountFullNotice } from './account-full-notice'
import { usePageHidden } from './page-hidden'
import { recordingSound, usePlayback } from './playback-provider'
import { useRecordFlow } from './record-flow-provider'
import { PlayCircle, useReplayLevels } from './recording-replay'
import { RecordingReview } from './recording-review'
import { useRecordings } from './recordings-provider'
import { SharedMark, ShareRecordingButton, useShares } from './share-recording'
import { ReplayWaveform } from './waveform'

export function RecordingsScreen() {
  const {
    recordings,
    recording,
    melodicRecordings,
    collectedNotes,
    deleteRecording,
    rescanning,
    rescanned,
    rescanRecording,
    rescanAll
  } = useRecordings()
  const [deleting, setDeleting] = useState<Recording | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const edited = editing === null ? undefined : recording(editing)
  const shares = useShares()
  const [opened, setOpened] = useState(false)
  useEffect(() => setOpened(true), [])
  usePageHidden(() => {
    setDeleting(null)
    setEditing(null)
  })

  if (recordings === null) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    )
  }

  const count = recordings.length
  const noNote = recordings.filter(canRescan).length
  return (
    <div className="flex flex-1 flex-col px-4 pb-6">
      <div className="flex items-center justify-between gap-2 pt-4 pb-3">
        <h1 className="text-3xl font-bold tracking-tight">Recordings</h1>
        {(noNote > 0 || rescanning !== null) && (
          <Button
            variant="ghost"
            className="h-11 text-base text-primary"
            disabled={rescanning !== null}
            onClick={() => void rescanAll()}
          >
            Re-scan all
          </Button>
        )}
      </div>
      <AccountFullNotice kind="recordings" />
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
            {[...recordings].reverse().map(listed => (
              <RecordingRow
                key={listed.id}
                recording={listed}
                onEdit={() => setEditing(listed.id)}
                onRescan={() => void rescanRecording(listed.id)}
                onDelete={() => setDeleting(listed)}
              />
            ))}
          </ul>
        </section>
      )}

      {edited && (
        <RecordingReview key={edited.id} recording={edited} onClose={() => setEditing(null)} />
      )}

      <AlertDialog open={deleting !== null} onOpenChange={open => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting && recordingName(deleting)}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting && shares?.links.has(deleting.id) && 'Its link stops working too. '}
              This can't be undone.
            </AlertDialogDescription>
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
  onEdit,
  onRescan,
  onDelete
}: {
  recording: Recording
  onEdit: () => void
  onRescan: () => void
  onDelete: () => void
}) {
  const { nowPlaying, playingPart, togglePlayback, playRecording } = usePlayback()
  const isPlaying = nowPlaying === recording.id
  const name = recordingName(recording)
  const part = playedPart(recording)
  const levels = useReplayLevels(recording, part)
  const placed = placedPitch(recording)
  const trimmed = trimOf(recording) !== null
  const shared = useShares()?.links.has(recording.id) ?? false

  return (
    <li
      className={cn('flex flex-col gap-2 py-3 pr-2 pl-4', isPlaying && 'bg-primary/10')}
      data-testid="recording-row"
    >
      <div className="flex items-center gap-1">
        <div className="relative flex min-w-0 flex-1 items-center gap-3.5">
          <button
            type="button"
            className="absolute inset-0 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            aria-label={[name, ...describe(recording)].join(', ')}
            aria-pressed={isPlaying}
            onClick={() => togglePlayback(recordingSound(recording))}
          />
          <span className="pointer-events-none relative">
            <PlayCircle isPlaying={isPlaying} />
          </span>
          <span className="pointer-events-none relative flex min-w-0 flex-1 flex-col gap-2">
            <span className="flex h-8 items-center justify-between gap-2">
              <span className="truncate font-semibold">{name}</span>
              <NotePill recording={recording} />
            </span>
            <span className="flex items-center gap-2">
              <ReplayWaveform
                levels={levels}
                view={part}
                playing={isPlaying ? playingPart : null}
                position={playbackPosition}
                label={`Play ${name} from a spot`}
                onScrubStart={stopPlayback}
                onPlayFrom={seconds => {
                  if (part.endSeconds - seconds >= 0.02)
                    playRecording(
                      recordingSound(recording, {
                        startSeconds: seconds,
                        endSeconds: part.endSeconds
                      })
                    )
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
            {(placed !== null || trimmed || shared) && (
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
                {shared && (placed !== null || trimmed) && <span aria-hidden>·</span>}
                {shared && <SharedMark />}
              </span>
            )}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Edit ${name}`}
          aria-haspopup="dialog"
          onClick={onEdit}
        >
          <Pencil />
        </Button>
        <ShareRecordingButton recording={recording} name={name} />
        <Button variant="ghost" size="icon" aria-label={`Delete ${name}`} onClick={onDelete}>
          <Trash2 />
        </Button>
      </div>
      <Status recording={recording} onRescan={onRescan} />
    </li>
  )
}

function NotePill({ recording }: { recording: Recording }) {
  const { state } = recording.analysis
  if (state === 'notAnalyzed') return null
  const pitch = songPitch(recording)
  const text = state === 'analyzing' ? 'Finding…' : pitch === null ? 'No note' : noteName(pitch)
  return (
    <span
      className={cn(
        'shrink-0 rounded-full bg-muted px-3 py-1 tabular-nums',
        pitch === null ? 'text-sm text-muted-foreground' : 'font-semibold'
      )}
      data-testid="recording-note"
    >
      {text}
    </span>
  )
}

function Status({ recording, onRescan }: { recording: Recording; onRescan: () => void }) {
  const { retryAnalysis } = useRecordFlow()
  const { rescanning } = useRecordings()
  const indent = 'pl-[3.625rem]'
  switch (recording.analysis.state) {
    case 'analyzing':
      return null
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
      if (!canRescan(recording)) return null
      return (
        <div className={indent}>
          {rescanning?.recordingId === recording.id ? (
            <Spinner aria-label="Re-scanning" data-testid={`rescanning-${recording.number}`} />
          ) : (
            <Button
              variant="outline"
              size="sm"
              aria-label={`Re-scan ${recordingName(recording)}`}
              disabled={rescanning !== null}
              onClick={onRescan}
            >
              Re-scan
            </Button>
          )}
        </div>
      )
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
      const pitch = songPitch(recording)
      parts.push(pitch === null ? 'No note' : noteName(pitch))
      if (placedPitch(recording) !== null) parts.push('placed by ear')
      if (trimOf(recording)) parts.push('trimmed')
    }
  }
  return parts
}
