'use client'

import { ChevronLeft, ChevronRight, RotateCcw, Scissors } from 'lucide-react'
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
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
import { formattedFartSeconds } from '@/lib/pitch-coverage'
import {
  fartPart,
  foundPart,
  HIGHEST_PLACED_PITCH,
  LOWEST_PLACED_PITCH,
  placedPitch,
  type Recording,
  recordingName,
  samePart,
  type Trim
} from '@/lib/recordings'
import { cn } from '@/lib/utils'
import { usePedos } from './pedos-provider'
import { octaveOf, PianoKeys, playPianoNote } from './piano-keys'
import { PlayCircle, partLevels, useTake } from './recording-replay'
import { formattedTime, ReplayWaveform } from './waveform'

const DESCRIPTION =
  'Play the fart, then tap the piano key it sounds closest to. The fart still plays as recorded. The note only says where Songs use it.'

/** The octave the picker opens on when the fart isn't placed yet: C3 to B3. */
const FIRST_OCTAVE = 3

/**
 * Places a Noise-like Recording on a note by ear, or leaves it out (ADR 0015): its play button and
 * waveform, one octave of piano keys at a time from C2 to B4, Place and Leave it out. A bottom
 * Sheet on a phone, and a centered Dialog from 768px. Nothing changes until Place, Move, Leave it
 * out or Take it off.
 */
export function PlaceByEar({
  recordingId,
  onClose
}: {
  /** The Recording to place, or null when the picker is closed. */
  recordingId: string | null
  onClose: () => void
}) {
  const pedos = usePedos()
  const isWide = useMediaQuery(wide)
  // The last Recording shown stays while the picker slides away.
  const [shownId, setShownId] = useState(recordingId)
  if (recordingId !== null && recordingId !== shownId) setShownId(recordingId)
  // Read live, so a placement or delete from another browser shows at once.
  const recording = shownId === null ? undefined : pedos.recording(shownId)
  const open = recordingId !== null && recording !== undefined

  const close = () => {
    if (shownId !== null && pedos.nowPlaying === shownId) pedos.stopPlayback()
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

/**
 * The fart, the octave, the keys and the buttons. The key picked starts at the placed note. The
 * waveform zooms to the fart, with the whole take drawn small underneath, and Trim shows handles
 * to keep just part of it (#293, ADR 0019). Play plays what's between them, which is what a saved
 * Trim keeps and its row plays.
 */
function Picker({
  recording,
  onDone,
  className
}: {
  recording: Recording
  onDone: () => void
  className?: string
}) {
  const pedos = usePedos()
  const placed = placedPitch(recording)
  const take = { startSeconds: 0, endSeconds: recording.seconds }
  const found = foundPart(recording) ?? take
  const current = fartPart(recording) ?? take
  const [selected, setSelected] = useState(placed)
  const [octave, setOctave] = useState(placed === null ? FIRST_OCTAVE : octaveOf(placed))
  const [trimming, setTrimming] = useState(false)
  // Where the handles are, and the fart the zoom frames: it follows them once a drag lets go.
  const [pending, setPending] = useState(current)
  const [framed, setFramed] = useState(current)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  // A Trim from another browser moves the handles too, unless the user has moved them here.
  const [seen, setSeen] = useState(current)
  if (!samePart(seen, current)) {
    setSeen(current)
    if (samePart(pending, seen)) {
      setPending(current)
      setFramed(current)
    }
  }
  const isPlaying = pedos.nowPlaying === recording.id
  const view = zoomView(framed, recording.seconds, trimming)
  const audio = useTake(recording)
  const { startSeconds: viewStart, endSeconds: viewEnd } = view
  const levels = useMemo(
    () => (audio ? partLevels(audio, { startSeconds: viewStart, endSeconds: viewEnd }) : []),
    [audio, viewStart, viewEnd]
  )
  const overview = useMemo(
    () =>
      audio ? partLevels(audio, { startSeconds: 0, endSeconds: Number.POSITIVE_INFINITY }) : [],
    [audio]
  )
  const length = formattedFartSeconds(pending.endSeconds - pending.startSeconds)
  const name = recordingName(recording)
  const playing = isPlaying ? pedos.playingPart : null
  const primary = primaryAction(selected, placed, pending, current, found)

  const stopHere = () => {
    if (isPlaying) pedos.stopPlayback()
  }
  const moveTo = (part: Trim) => {
    stopHere()
    setPending(part)
    setFramed(part)
  }
  // A new Trim's fart is found before it's saved; if that fails, the picker stays open and says so.
  const place = async () => {
    const change: { placedPitch?: number | null; handles?: Trim | null } = {}
    if (selected !== null && selected !== placed) change.placedPitch = selected
    if (!samePart(pending, current)) change.handles = samePart(pending, found) ? null : pending
    if (!change.handles) {
      if (Object.keys(change).length > 0) void pedos.placeRecording(recording.id, change)
      onDone()
      return
    }
    setSaving(true)
    setFailed(false)
    const saved = await pedos.placeRecording(recording.id, change)
    setSaving(false)
    if (saved) onDone()
    else setFailed(true)
  }
  const leave = () => {
    if (placed !== null) void pedos.placeRecording(recording.id, { placedPitch: null })
    onDone()
  }

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2.5">
        <button
          type="button"
          className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-label={`Play the fart in ${name}, ${length}`}
          aria-pressed={isPlaying}
          onClick={() => pedos.togglePlayback(recording, pending)}
        >
          <PlayCircle isPlaying={isPlaying} />
        </button>
        <ReplayWaveform
          levels={levels}
          view={view}
          playing={playing}
          position={pedos.playbackPosition}
          dim={pending}
          label={`Play ${name} from a spot`}
          onScrubStart={pedos.stopPlayback}
          onPlayFrom={seconds => {
            // From inside the fart to its end; from after it, to the end of the take.
            const to = seconds < pending.endSeconds - 0.01 ? pending.endSeconds : recording.seconds
            if (to - seconds >= 0.02)
              pedos.playRecording(recording, { startSeconds: seconds, endSeconds: to })
          }}
          trim={
            trimming
              ? {
                  part: pending,
                  onChange: (part, done) => {
                    stopHere()
                    setPending(part)
                    if (done) setFramed(part)
                  }
                }
              : undefined
          }
          className="h-9"
        />
        <span className="text-sm text-muted-foreground tabular-nums" data-testid="place-length">
          {length}
        </span>
        <ReplayWaveform
          levels={overview}
          view={take}
          playing={playing}
          position={pedos.playbackPosition}
          window={view}
          small
          className="col-start-2 h-3"
        />
        <div className="col-span-2 col-start-2 flex min-h-7 flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-pressed={trimming}
            onClick={() => {
              stopHere()
              setTrimming(!trimming)
            }}
          >
            <Scissors />
            {trimming ? 'Done' : 'Trim'}
          </Button>
          {trimming && (
            <>
              <span
                className="text-[13px] text-muted-foreground tabular-nums"
                data-testid="trim-readout"
              >
                {formattedTime(pending.startSeconds)} to {formattedTime(pending.endSeconds)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Reset to the fart Farty found"
                disabled={samePart(pending, found)}
                onClick={() => moveTo(found)}
              >
                <RotateCcw />
                Reset
              </Button>
            </>
          )}
        </div>
      </div>

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
        {failed && (
          <p role="alert" className="text-sm text-destructive">
            Couldn't save the trim. Try again.
          </p>
        )}
        <Button
          size="lg"
          className="h-12 w-full text-base"
          disabled={!primary.enabled || saving}
          onClick={place}
        >
          {primary.label}
        </Button>
        <Button variant="outline" size="lg" className="h-12 w-full text-base" onClick={leave}>
          {placed === null ? 'Leave it out' : 'Take it off'}
        </Button>
      </div>
    </div>
  )
}

/**
 * What the picker's waveform shows: the fart across the width, with a little of the take either
 * side, and more while trimming, so a handle can be pulled out past it.
 */
function zoomView(fart: Trim, seconds: number, trimming: boolean): Trim {
  const length = fart.endSeconds - fart.startSeconds
  const room = trimming ? Math.max(0.15, length * 0.5) : Math.max(0.04, length * 0.1)
  return {
    startSeconds: Math.max(0, fart.startSeconds - room),
    endSeconds: Math.min(seconds, fart.endSeconds + room)
  }
}

/**
 * The picker's main button: "Place at E3" or "Move to G2" for a new key, then "Save trim" or
 * "Remove trim" for handles moved, then "Placed at E3", or how to pick a note. Place keeps both.
 */
function primaryAction(
  selected: number | null,
  placed: number | null,
  pending: Trim,
  current: Trim,
  found: Trim
): { label: string; enabled: boolean } {
  if (selected !== null && selected !== placed) {
    const label = placed === null ? 'Place at' : 'Move to'
    return { label: `${label} ${noteName(selected)}`, enabled: true }
  }
  if (!samePart(pending, current)) {
    return { label: samePart(pending, found) ? 'Remove trim' : 'Save trim', enabled: true }
  }
  if (selected === null) return { label: 'Tap a key to choose a note', enabled: false }
  return { label: `Placed at ${noteName(selected)}`, enabled: false }
}

/** Whether `query` matches now, kept current. False before the page is in a browser. */
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
