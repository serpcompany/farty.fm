'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useCallback, useState, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { wide } from '@/lib/desktop'
import { noteName } from '@/lib/pitch'
import { formattedFartLength } from '@/lib/pitch-coverage'
import {
  HIGHEST_PLACED_PITCH,
  LOWEST_PLACED_PITCH,
  placedPitch,
  type Recording,
  recordingName
} from '@/lib/recordings'
import { cn } from '@/lib/utils'
import { octaveOf, PianoKeys, playPianoNote } from './piano-keys'
import { recordingSound, usePlayback } from './playback-provider'
import { PlayCircle, useReplayLevels } from './recording-replay'
import { useRecordings } from './recordings-provider'
import { Waveform } from './waveform'

const DESCRIPTION =
  'Play the fart, then tap the piano key it sounds closest to. The fart still plays as recorded. The note only says where Songs use it.'

const FIRST_OCTAVE = 3

export function PlaceByEar({
  recordingId,
  onClose
}: {
  recordingId: string | null
  onClose: () => void
}) {
  const recordings = useRecordings()
  const { stopPlaying } = usePlayback()
  const isWide = useMediaQuery(wide)
  const [shownId, setShownId] = useState(recordingId)
  if (recordingId !== null && recordingId !== shownId) setShownId(recordingId)
  const recording = shownId === null ? undefined : recordings.recording(shownId)
  const open = recordingId !== null && recording !== undefined

  const close = () => {
    if (shownId !== null) stopPlaying(shownId)
    onClose()
  }
  const openChanged = (next: boolean) => {
    if (!next) close()
  }
  const title = recording && `Place ${recordingName(recording)} on a note`
  const body = (className?: string) =>
    recording && (
      <Picker key={recording.id} recording={recording} onDone={close} className={className} />
    )

  if (isWide) {
    return (
      <Dialog open={open} onOpenChange={openChanged}>
        <DialogContent className="sm:max-w-md" data-testid="place-by-ear">
          <DialogHeader className="pr-8">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{DESCRIPTION}</DialogDescription>
          </DialogHeader>
          {body()}
        </DialogContent>
      </Dialog>
    )
  }
  return (
    <Sheet open={open} onOpenChange={openChanged}>
      <SheetContent
        side="bottom"
        className="max-h-[calc(100dvh-1.5rem)] overflow-y-auto"
        data-testid="place-by-ear"
      >
        <SheetHeader className="pr-12 pb-0">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{DESCRIPTION}</SheetDescription>
        </SheetHeader>
        {body('px-4 pb-[max(1rem,env(safe-area-inset-bottom))]')}
      </SheetContent>
    </Sheet>
  )
}

function Picker({
  recording,
  onDone,
  className
}: {
  recording: Recording
  onDone: () => void
  className?: string
}) {
  const { placeRecording } = useRecordings()
  const { nowPlaying, togglePlayback } = usePlayback()
  const placed = placedPitch(recording)
  const [selected, setSelected] = useState(placed)
  const [octave, setOctave] = useState(placed === null ? FIRST_OCTAVE : octaveOf(placed))
  const levels = useReplayLevels(recording)
  const isPlaying = nowPlaying === recording.id
  const length = formattedFartLength(recording)

  const place = (pitch: number | null) => {
    if (pitch !== placed) placeRecording(recording.id, pitch)
    onDone()
  }

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <button
        type="button"
        className="flex items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label={`Play ${recordingName(recording)}, ${length}`}
        aria-pressed={isPlaying}
        onClick={() => togglePlayback(recordingSound(recording))}
      >
        <PlayCircle isPlaying={isPlaying} />
        <Waveform levels={levels} isPlaying={isPlaying} className="h-[26px] min-w-0 flex-1" />
        <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{length}</span>
      </button>

      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Octave down"
          disabled={octave <= octaveOf(LOWEST_PLACED_PITCH)}
          onClick={() => setOctave(octave - 1)}
        >
          <ChevronLeft />
        </Button>
        <p className="text-[15px] font-semibold" aria-live="polite" data-testid="place-octave">
          Octave {octave}
          <span className="ml-1.5 text-[13px] font-normal text-muted-foreground tabular-nums">
            C{octave} – B{octave}
          </span>
        </p>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Octave up"
          disabled={octave >= octaveOf(HIGHEST_PLACED_PITCH)}
          onClick={() => setOctave(octave + 1)}
        >
          <ChevronRight />
        </Button>
      </div>

      <PianoKeys
        octave={octave}
        selected={selected}
        placed={placed}
        onKey={midi => {
          playPianoNote(midi)
          setSelected(midi)
        }}
      />

      <div className="flex flex-col gap-2">
        <Button
          size="lg"
          className="h-12 w-full text-base"
          disabled={selected === null || selected === placed}
          onClick={() => selected !== null && place(selected)}
        >
          {placeLabel(selected, placed)}
        </Button>
        <Button
          variant="outline"
          size="lg"
          className="h-12 w-full text-base"
          onClick={() => place(null)}
        >
          {placed === null ? 'Leave it out' : 'Take it off'}
        </Button>
      </div>
    </div>
  )
}

function placeLabel(selected: number | null, placed: number | null): string {
  if (selected === null) return 'Tap a key to choose a note'
  if (selected === placed) return `Placed at ${noteName(selected)}`
  if (placed === null) return `Place at ${noteName(selected)}`
  return `Move to ${noteName(selected)}`
}

function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (changed: () => void) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', changed)
      return () => list.removeEventListener('change', changed)
    },
    [query]
  )
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  )
}
