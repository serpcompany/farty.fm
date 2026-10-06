'use client'

import { AudioLines, CirclePlay, CircleStop, Trash2 } from 'lucide-react'
import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle
} from '@/components/ui/item'
import { Spinner } from '@/components/ui/spinner'
import { noteName } from '@/lib/pitch'
import {
  firstFartUsed,
  formattedLength,
  type Recording,
  recordingName,
  recordingPitch,
  replaySegment
} from '@/lib/recordings'
import { usePedos } from './pedos-provider'

/** The Recordings tab: every fart, newest first, with its note. Play or delete each one. */
export function RecordingsScreen() {
  const pedos = usePedos()
  const [deleting, setDeleting] = useState<Recording | null>(null)

  if (pedos.recordings === null) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col px-4 pb-6">
      <h1 className="pt-4 pb-3 text-3xl font-bold tracking-tight">Recordings</h1>
      {pedos.recordings.length === 0 ? (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <AudioLines />
            </EmptyMedia>
            <EmptyTitle>No Recordings yet</EmptyTitle>
            <EmptyDescription>Record your first fart on the Record tab.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ItemGroup className="gap-2" data-testid="recordings-list">
          {[...pedos.recordings].reverse().map(recording => (
            <RecordingRow
              key={recording.id}
              recording={recording}
              onDelete={() => setDeleting(recording)}
            />
          ))}
        </ItemGroup>
      )}

      <AlertDialog open={deleting !== null} onOpenChange={open => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting && recordingName(deleting)}?</AlertDialogTitle>
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
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function RecordingRow({ recording, onDelete }: { recording: Recording; onDelete: () => void }) {
  const pedos = usePedos()
  const isPlaying = pedos.nowPlaying === recording.id
  const pitch = recordingPitch(recording)
  const segment = replaySegment(recording)
  const length = segment ? segment.end - segment.start : recording.seconds

  return (
    <Item variant="muted" data-testid="recording-row">
      <ItemMedia>
        <Button
          variant="ghost"
          size="icon-lg"
          aria-label={
            isPlaying ? `Stop ${recordingName(recording)}` : `Play ${recordingName(recording)}`
          }
          onClick={() => pedos.togglePlayback(recording)}
        >
          {isPlaying ? <CircleStop className="size-7" /> : <CirclePlay className="size-7" />}
        </Button>
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{recordingName(recording)}</ItemTitle>
        <ItemDescription>
          {formattedLength(length)}
          {firstFartUsed(recording) && ' · first fart used'}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <span className="font-semibold tabular-nums" data-testid="recording-note">
          {noteLabel(recording, pitch)}
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Delete ${recordingName(recording)}`}
          onClick={onDelete}
        >
          <Trash2 />
        </Button>
      </ItemActions>
    </Item>
  )
}

function noteLabel(recording: Recording, pitch: number | null): string {
  switch (recording.analysis.state) {
    case 'analyzing':
      return '…'
    case 'notAnalyzed':
      return 'not analyzed'
    case 'analyzed':
      return pitch === null ? 'noise-like' : noteName(pitch)
  }
}
