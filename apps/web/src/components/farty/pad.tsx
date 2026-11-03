'use client'

import { Plus } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { startAudioInTap } from '@/lib/audio/context'
import { noteName } from '@/lib/pitch'
import {
  isNoiseLike,
  placedPitch,
  type Recording,
  recordingName,
  songPitch
} from '@/lib/recordings'
import { cn } from '@/lib/utils'

export type PadSound = 'ready' | 'loading' | 'unavailable' | undefined

export function padNote(recording: Recording): string | null {
  const pitch = songPitch(recording)
  if (pitch !== null) return noteName(pitch)
  return isNoiseLike(recording) ? 'noise-like' : null
}

export function describePadRecording(recording: Recording, shown: (string | null)[]): string {
  const placed = placedPitch(recording) !== null
  return [...shown, placed && 'placed by ear'].filter(Boolean).join(', ')
}

export function Pad({
  pad,
  recording,
  sound,
  playing,
  editing,
  onPlay,
  onChoose
}: {
  pad: number
  recording: Recording | undefined
  sound: PadSound
  playing: boolean
  editing: boolean
  onPlay: (at: number) => void
  onChoose: () => void
}) {
  const plays = recording !== undefined && !editing
  const pitch = recording ? songPitch(recording) : null
  const name = recording ? recordingName(recording) : null
  const label = [
    `Pad ${pad + 1}`,
    recording ? describePadRecording(recording, [padNote(recording), name]) : 'Empty',
    !plays && 'Choose its fart',
    plays && sound === 'loading' && 'Loading',
    plays && sound === 'unavailable' && 'Can’t play it yet'
  ]
    .filter(Boolean)
    .join('. ')

  return (
    <button
      type="button"
      aria-label={label}
      aria-haspopup={plays ? undefined : 'dialog'}
      data-testid="pad"
      data-pad={pad + 1}
      data-ready={sound === 'ready' || undefined}
      aria-busy={(plays && sound === 'loading') || undefined}
      data-playing={playing || undefined}
      className={cn(
        'relative flex aspect-square touch-manipulation flex-col items-center justify-center gap-1 rounded-2xl bg-muted/60 p-2 text-center transition-colors duration-75 outline-none select-none [-webkit-touch-callout:none] focus-visible:ring-3 focus-visible:ring-ring/50',
        plays && 'active:bg-primary/25 data-playing:bg-primary/15',
        editing && 'border-2 border-dashed border-foreground/30',
        !recording && 'text-muted-foreground',
        plays && sound === 'unavailable' && 'opacity-50'
      )}
      onPointerDown={event => {
        if (plays && event.button === 0) onPlay(event.timeStamp)
      }}
      onClick={event => {
        if (!plays) {
          onChoose()
          return
        }
        startAudioInTap()
        const fromKeyboard = event.detail === 0
        if (fromKeyboard) onPlay(event.timeStamp)
      }}
      onContextMenu={event => event.preventDefault()}
    >
      {plays && sound === 'loading' && (
        <Spinner aria-hidden className="absolute top-2 right-2 size-3.5 text-muted-foreground" />
      )}
      {recording ? (
        <>
          {pitch !== null ? (
            <span className="text-2xl font-semibold tabular-nums">{noteName(pitch)}</span>
          ) : (
            <span className="text-sm text-muted-foreground">{padNote(recording)}</span>
          )}{' '}
          <span className="truncate text-xs text-muted-foreground">{name}</span>
        </>
      ) : (
        <Plus className="size-6" aria-hidden />
      )}
    </button>
  )
}
