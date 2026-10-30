'use client'

import { AudioLines, Check, ChevronLeft, Plus, XIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { startAudioInTap } from '@/lib/audio/context'
import {
  keepPadSounds,
  loadPadSound,
  PadAudioUnavailable,
  playPadSound,
  stopPadSounds
} from '@/lib/audio/pad-player'
import { loadPads, savePads } from '@/lib/pad-store'
import { type AssignedPads, assignPad, PAD_COUNT, padMapping } from '@/lib/pads'
import { noteName } from '@/lib/pitch'
import { formattedFartLength } from '@/lib/pitch-coverage'
import { loadAudio } from '@/lib/recording-store'
import {
  isNoiseLike,
  placedPitch,
  type Recording,
  recordingName,
  songPitch
} from '@/lib/recordings'
import { reportError } from '@/lib/telemetry/errors'
import { cn } from '@/lib/utils'
import { openVisit } from '@/lib/visit'
import { usePedos } from './pedos-provider'
import { previousPage } from './previous-page'

/**
 * The Sound Pad (#277): twelve Pads, each playing one of the user's Recordings at a tap, raw, as
 * recorded. Taps overlap and mix, a finger per Pad. The Pads start filled with the Recordings,
 * lowest note first; Edit puts any Recording on any Pad, kept in this browser (`pad-store.ts`).
 * Inside the Compose tab, like Song Creator.
 */
export function SoundPad() {
  const pedos = usePedos()
  const [assigned, setAssigned] = useState<AssignedPads | null>(null)
  const [editing, setEditing] = useState(false)
  /** The Pad whose Recording is being chosen, or null. */
  const [choosing, setChoosing] = useState<number | null>(null)
  /** Each Recording's Pad sound, once decoded, by Recording id. */
  const [sounds, setSounds] = useState<ReadonlyMap<string, AudioBuffer>>(new Map())
  /** The Recordings whose Pad sound couldn't load, until a press tries again. */
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set())
  /** How many sounds each Pad plays now. */
  const [playing, setPlaying] = useState<readonly number[]>(() => Array(PAD_COUNT).fill(0))

  // After the visit's clear, so a guest's new visit never reads the last one's Pads.
  useEffect(() => {
    let left = false
    openVisit()
      .library.then(loadPads)
      .catch(error => {
        reportError('pad-mapping-failed', error)
        return new Map<number, string>()
      })
      .then(pads => {
        if (!left) setAssigned(pads)
      })
    return () => {
      left = true
    }
  }, [])

  const mapping = pedos.recordings && assigned ? padMapping(pedos.recordings, assigned) : null

  // Every Pad's sound decodes as soon as it's on a Pad, so a tap only starts it. Audio this browser
  // can't get yet, such as offline, isn't an error worth a report (as `upgradeAnalyses`); a sound
  // that won't decode is.
  const load = useCallback((id: string, left: () => boolean) => {
    loadPadSound(id, () => loadAudio(id)).then(
      sound => {
        if (!left()) setSounds(current => new Map(current).set(id, sound))
      },
      error => {
        if (left()) return
        setFailed(current => new Set(current).add(id))
        if (!(error instanceof PadAudioUnavailable)) reportError('pad-sound-failed', error)
      }
    )
  }, [])
  const onPads = [...new Set(mapping)]
    .filter(id => id !== null)
    .sort()
    .join(' ')
  useEffect(() => {
    const ids = new Set(onPads.split(' ').filter(Boolean))
    keepPadSounds(ids)
    setSounds(current =>
      [...current.keys()].every(id => ids.has(id))
        ? current
        : new Map([...current].filter(([id]) => ids.has(id)))
    )
    // Every one loads again.
    setFailed(current => (current.size === 0 ? current : new Set()))
    let left = false
    for (const id of ids) load(id, () => left)
    return () => {
      left = true
    }
  }, [onPads, load])

  // Leaving the Sound Pad, or hiding the page, stops every Pad and closes the chooser.
  useEffect(() => {
    const visibilityChanged = () => {
      if (document.visibilityState !== 'hidden') return
      stopPadSounds()
      setChoosing(null)
    }
    document.addEventListener('visibilitychange', visibilityChanged)
    return () => {
      document.removeEventListener('visibilitychange', visibilityChanged)
      stopPadSounds()
    }
  }, [])

  const counted = (pad: number, by: number) =>
    setPlaying(current => current.map((count, i) => (i === pad ? Math.max(0, count + by) : count)))
  const start = (pad: number, sound: AudioBuffer) => {
    playPadSound(sound, () => counted(pad, -1))
    counted(pad, 1)
  }
  const play = (pad: number, id: string) => {
    const sound = sounds.get(id)
    if (sound) {
      start(pad, sound)
      return
    }
    // Not ready: the press is dropped, so presses never pile up and start together later. A sound
    // that couldn't load tries again.
    if (!failed.has(id)) return
    setFailed(current => {
      const next = new Set(current)
      next.delete(id)
      return next
    })
    load(id, () => false)
  }
  const assign = (pad: number, id: string) => {
    if (!mapping) return
    const next = assignPad(mapping, pad, id)
    setAssigned(next)
    savePads(next).catch(error => reportError('pad-mapping-failed', error))
  }

  const loaded = mapping !== null
  const hasRecordings = (pedos.recordings?.length ?? 0) > 0

  return (
    <div className="flex flex-1 flex-col">
      <header className="grid grid-cols-[4.5rem_1fr_4.5rem] items-center gap-2 px-2 pt-2 pb-3">
        <BackToCompose />
        <h1 className="truncate text-center font-semibold">Sound Pad</h1>
        {loaded && hasRecordings && (
          <Button
            variant="ghost"
            className="h-11 justify-self-end px-3 text-base"
            aria-pressed={editing}
            onClick={() => setEditing(!editing)}
          >
            {editing ? 'Done' : 'Edit'}
          </Button>
        )}
      </header>

      {!loaded && (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      )}
      {loaded && !hasRecordings && (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <AudioLines />
            </EmptyMedia>
            <EmptyTitle>No Recordings yet</EmptyTitle>
            <EmptyDescription>
              Go to the Record tab and tap the red button. Your farts fill the Pads.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {loaded && hasRecordings && (
        <div className="flex flex-col gap-3 px-4 pb-6">
          <p className="text-center text-sm text-muted-foreground" aria-live="polite">
            {editing ? 'Tap a Pad to choose its fart.' : 'Tap the Pads to play your farts.'}
          </p>
          <ul className="grid grid-cols-3 gap-3 md:grid-cols-4" data-testid="pads">
            {mapping.map((id, pad) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a Pad is its place in the grid
              <li key={pad} className="contents">
                <Pad
                  pad={pad}
                  recording={id === null ? undefined : pedos.recording(id)}
                  sound={
                    id === null
                      ? undefined
                      : sounds.has(id)
                        ? 'ready'
                        : failed.has(id)
                          ? 'unavailable'
                          : 'loading'
                  }
                  playing={playing[pad] > 0}
                  editing={editing}
                  onPlay={() => id !== null && play(pad, id)}
                  onChoose={() => setChoosing(pad)}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      <PadChooser
        pad={choosing}
        current={choosing === null ? null : (mapping?.[choosing] ?? null)}
        recordings={pedos.recordings ?? []}
        onChoose={id => {
          if (choosing !== null) assign(choosing, id)
          setChoosing(null)
        }}
        onClose={() => setChoosing(null)}
      />
    </div>
  )
}

/** Back to the Compose it came from, or in its place, so the system Back never opens it again. */
function BackToCompose() {
  const router = useRouter()
  return (
    <Link
      href="/compose/"
      replace
      onClick={event => {
        if (previousPage()?.replace(/\/$/, '') !== '/compose') return
        event.preventDefault()
        router.back()
      }}
      aria-label="Back to Compose"
      className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'size-11')}
    >
      <ChevronLeft className="size-6" />
    </Link>
  )
}

/**
 * A Pad: its Recording's note (or "noise-like") and name, or a plus when it has none. It plays on
 * the press itself, not on the release, so each finger plays its own Pad at once. Until its sound
 * is ready it shows a spinner and a press does nothing. Editing, or empty, a tap chooses its
 * Recording instead.
 */
function Pad({
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
  /**
   * Its sound: decoded, so a press plays it at once; loading; or one that couldn't load, which a
   * press tries again.
   */
  sound: 'ready' | 'loading' | 'unavailable' | undefined
  playing: boolean
  editing: boolean
  onPlay: () => void
  onChoose: () => void
}) {
  const plays = recording !== undefined && !editing
  const pitch = recording ? songPitch(recording) : null
  const name = recording ? recordingName(recording) : null
  const label = [
    `Pad ${pad + 1}`,
    recording ? describe(recording) : 'Empty',
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
        if (plays && event.button === 0) onPlay()
      }}
      onClick={event => {
        if (!plays) {
          onChoose()
          return
        }
        // The release is what a touch browser counts as a tap that may start audio.
        startAudioInTap()
        // From the keyboard: Enter or Space.
        if (event.detail === 0) onPlay()
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
            <span className="text-sm text-muted-foreground">{note(recording)}</span>
          )}
          <span className="truncate text-xs text-muted-foreground">{name}</span>
        </>
      ) : (
        <Plus className="size-6" aria-hidden />
      )}
    </button>
  )
}

/**
 * Chooses the Recording a Pad plays: every Recording, newest first, with its note and length. A
 * bottom Sheet, as a locked Song's.
 */
function PadChooser({
  pad,
  current,
  recordings,
  onChoose,
  onClose
}: {
  /** The Pad, or null when the chooser is closed. */
  pad: number | null
  /** The Recording the Pad plays now. */
  current: string | null
  recordings: readonly Recording[]
  onChoose: (id: string) => void
  onClose: () => void
}) {
  // The last Pad shown stays while the sheet slides away.
  const [shown, setShown] = useState(pad)
  if (pad !== null && pad !== shown) setShown(pad)

  return (
    <Sheet open={pad !== null} onOpenChange={open => !open && onClose()}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[calc(100dvh-1.5rem)] max-w-md gap-0 rounded-t-2xl pb-[env(safe-area-inset-bottom)]"
        data-testid="pad-chooser"
        showCloseButton={false}
      >
        <SheetHeader className="items-center px-12 pt-4 pb-2">
          <SheetTitle className="text-center font-semibold">
            Pad {shown === null ? '' : shown + 1}
          </SheetTitle>
          <SheetDescription className="text-center">Choose the fart it plays.</SheetDescription>
        </SheetHeader>
        <ul className="mx-4 mb-4 divide-y overflow-y-auto rounded-xl bg-muted/60">
          {[...recordings].reverse().map(recording => {
            const isCurrent = recording.id === current
            return (
              <li key={recording.id}>
                <button
                  type="button"
                  aria-current={isCurrent || undefined}
                  aria-label={describe(recording)}
                  className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset active:bg-muted"
                  onClick={() => onChoose(recording.id)}
                >
                  <span className="font-semibold">{recordingName(recording)}</span>
                  <span className="flex items-center gap-2 text-muted-foreground tabular-nums">
                    {note(recording)}
                    <span>{formattedFartLength(recording)}</span>
                    <Check
                      className={cn('size-4 text-primary', !isCurrent && 'invisible')}
                      aria-hidden
                    />
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        <SheetClose
          render={
            <Button variant="ghost" size="icon" className="absolute top-1.5 right-1.5 size-11" />
          }
        >
          <XIcon />
          <span className="sr-only">Close</span>
        </SheetClose>
      </SheetContent>
    </Sheet>
  )
}

/** A Recording's note as a Pad and the chooser show it: "G3", "noise-like", or nothing yet. */
function note(recording: Recording): string | null {
  const pitch = songPitch(recording)
  if (pitch !== null) return noteName(pitch)
  return isNoiseLike(recording) ? 'noise-like' : null
}

/** "Recording 3, G3", "Recording 4, C3, placed by ear", "Recording 5, noise-like". */
function describe(recording: Recording): string {
  const placed = placedPitch(recording) !== null
  return [recordingName(recording), note(recording), placed && 'placed by ear']
    .filter(Boolean)
    .join(', ')
}
