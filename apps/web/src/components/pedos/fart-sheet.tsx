'use client'

import { Ban, Check, Piano, Play, RotateCcw, Square, XIcon } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Item, ItemActions, ItemGroup } from '@/components/ui/item'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { type FartChange, type FartRow, type FartSheet, noteDistance } from '@/lib/fart-sheet'
import { noteName } from '@/lib/pitch'
import { formattedFartLength } from '@/lib/pitch-coverage'
import { formattedLength, type Recording, recordingName } from '@/lib/recordings'
import { cn } from '@/lib/utils'
import { usePedos } from './pedos-provider'
import { usePianoPreview } from './use-piano-preview'

/** How long the pitch's piano note is held, in seconds, before it's let go. */
const PIANO_NOTE_SECONDS = 2

/**
 * Song Creator's fart sheet (#360): every fart of the user's that can play one of the Song's
 * pitches, to hear, swap in, leave out of the Song or use again, and Reset to automatic. Each
 * change closes it.
 */
export function FartSheetView({
  sheet,
  onClose,
  onChange
}: {
  /** The pitch shown, or null when the sheet is closed. */
  sheet: FartSheet | null
  onClose: () => void
  onChange: (change: FartChange) => void
}) {
  const pedos = usePedos()
  // The last pitch shown stays while the sheet slides away.
  const [shown, setShown] = useState(sheet)
  if (sheet !== null && sheet !== shown) setShown(sheet)
  const note = shown ? noteName(shown.note) : ''
  // The pitch on piano, as one player with Farty's (#373): playing a fart stops it, and so does
  // closing the sheet, which every pick, leave-out and reset does too.
  const piano = usePianoPreview()
  const stopPiano = piano.stop
  useEffect(() => {
    if (sheet === null) stopPiano()
  }, [sheet, stopPiano])
  const row = (fart: FartRow, group: 'use' | 'other' | 'leftOut') => {
    const recording = pedos.recording(fart.id)
    if (!recording || !shown) return null
    return (
      <FartOption
        key={fart.id}
        fart={fart}
        recording={recording}
        action={
          fart.id === shown.inUse?.id ? (
            <Badge variant="secondary" className="h-7 px-2.5 text-sm">
              <Check aria-hidden />
              In use
            </Badge>
          ) : group === 'leftOut' ? (
            <Button
              variant="outline"
              className="h-11 px-3"
              onClick={() => onChange({ kind: 'useAgain', id: fart.id })}
            >
              Use again
            </Button>
          ) : (
            <Button
              variant="outline"
              className="h-11 px-3"
              onClick={() => onChange({ kind: 'swap', songPitch: shown.songPitch, id: fart.id })}
            >
              Swap
            </Button>
          )
        }
        canPlay={group !== 'leftOut'}
      />
    )
  }

  return (
    <Sheet
      open={sheet !== null}
      onOpenChange={open => {
        if (open) return
        pedos.stopPlayback()
        stopPiano()
        onClose()
      }}
    >
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[90dvh] max-w-md gap-0 rounded-t-2xl pb-[env(safe-area-inset-bottom)]"
        data-testid="fart-sheet"
        showCloseButton={false}
      >
        <SheetHeader className="items-center px-12 pt-5 pb-3 text-center">
          <SheetTitle className="text-4xl font-bold tabular-nums">{note}</SheetTitle>
          <SheetDescription>
            {shown?.noteCount === 1 ? '1 note' : `${shown?.noteCount ?? 0} notes`} in this Song
          </SheetDescription>
          {shown && (
            <Button
              variant="outline"
              size="sm"
              className="h-11 px-3"
              onClick={() =>
                piano.play(0, [{ midi: shown.note, start: 0, seconds: PIANO_NOTE_SECONDS }])
              }
            >
              <Piano aria-hidden />
              Hear {note} on piano
            </Button>
          )}
        </SheetHeader>
        <SheetClose
          render={
            <Button variant="ghost" size="icon" className="absolute top-1.5 right-1.5 size-11" />
          }
        >
          <XIcon />
          <span className="sr-only">Close</span>
        </SheetClose>
        {shown && (
          <>
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-2">
              {shown.inUse === null && (
                <p className="flex items-center gap-2 rounded-xl border border-dashed px-4 py-3 text-muted-foreground">
                  <Ban className="size-4 shrink-0" aria-hidden />
                  No fart plays {note} now.
                </p>
              )}
              {(shown.inUse || shown.free.length > 0) && (
                <ItemGroup className="gap-1">
                  {shown.inUse && row(shown.inUse, 'use')}
                  {shown.free.map(fart => row(fart, 'use'))}
                </ItemGroup>
              )}
              {shown.others.length > 0 && (
                <FartGroup title="Playing other notes in this Song">
                  {shown.others.map(fart => row(fart, 'other'))}
                </FartGroup>
              )}
              {shown.leftOut.length > 0 && (
                <FartGroup title="Left out of this Song">
                  {shown.leftOut.map(fart => row(fart, 'leftOut'))}
                </FartGroup>
              )}
              <p className="px-1 text-sm text-muted-foreground">
                A fart can play {note} when it's within 3 semitones of it, or an octave away, and
                lasts {formattedLength(shown.neededSeconds)} or longer.
              </p>
            </div>
            {(shown.inUse || shown.hasChange) && (
              <SheetFooter className="border-t pt-3">
                {shown.inUse && shown.isOnlyFart && (
                  <p className="text-sm text-muted-foreground" data-testid="only-fart">
                    No other fart of yours can play {note}. Without this one the Song locks until
                    you record one or reset.
                  </p>
                )}
                {shown.inUse && (
                  <Button
                    variant="outline"
                    className="h-11 w-full text-base text-destructive hover:text-destructive"
                    onClick={() =>
                      shown.inUse &&
                      onChange({ kind: 'leaveOut', songPitch: shown.songPitch, id: shown.inUse.id })
                    }
                  >
                    <Ban aria-hidden />
                    Don't use this fart in this Song
                  </Button>
                )}
                {shown.hasChange && (
                  <Button
                    variant="ghost"
                    className="h-11 w-full text-base"
                    onClick={() => onChange({ kind: 'reset', songPitch: shown.songPitch })}
                  >
                    <RotateCcw aria-hidden />
                    Reset to automatic
                  </Button>
                )}
              </SheetFooter>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

/** A labelled group of the sheet's farts. */
function FartGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5" aria-label={title}>
      <h3 className="px-1 text-xs text-muted-foreground">{title}</h3>
      <ItemGroup className="gap-1">{children}</ItemGroup>
    </section>
  )
}

/**
 * A fart that can play the sheet's pitch: play (tap the row to hear it raw), its name, its own
 * note, how far it is from the pitch and its length, how the Song uses it, and its action.
 */
function FartOption({
  fart,
  recording,
  action,
  canPlay
}: {
  fart: FartRow
  recording: Recording
  action: ReactNode
  /** A left-out fart has no play button. */
  canPlay: boolean
}) {
  const pedos = usePedos()
  const isPlaying = pedos.nowPlaying === recording.id
  const name = recordingName(recording)
  const meta = `${noteName(fart.note)} · ${noteDistance(fart.shift)} · ${formattedFartLength(recording)}`
  const uses = [
    fart.isYourPick ? 'Your pick' : fart.isFartysPick && "Farty's pick",
    fart.playsNote !== null && `Plays ${noteName(fart.playsNote)} now`
  ].filter((part): part is string => typeof part === 'string')
  const text = (
    <span className="flex min-w-0 flex-col">
      <span className="font-medium">{name}</span>
      <span className="text-sm text-muted-foreground">{meta}</span>
      {uses.length > 0 && (
        <span
          className={cn(
            'text-sm',
            fart.isYourPick ? 'font-semibold text-brand-strong' : 'text-muted-foreground'
          )}
        >
          {uses.join(' · ')}
        </span>
      )}
    </span>
  )
  return (
    <Item
      role="listitem"
      size="sm"
      className={cn('flex-nowrap px-2', isPlaying && 'bg-primary/10')}
      data-testid="fart-option"
    >
      {canPlay ? (
        <button
          type="button"
          className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg text-left text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-label={[name, meta, ...uses].join(', ')}
          aria-pressed={isPlaying}
          onClick={() => pedos.togglePlayback(recording)}
        >
          <span
            aria-hidden
            className={cn(
              'flex size-11 shrink-0 items-center justify-center rounded-full',
              isPlaying ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary'
            )}
          >
            {isPlaying ? (
              <Square className="size-4 fill-current" />
            ) : (
              <Play className="size-4 fill-current" />
            )}
          </span>
          {text}
        </button>
      ) : (
        <span className="flex min-h-11 min-w-0 flex-1 items-center pl-1 text-base">{text}</span>
      )}
      <ItemActions>{action}</ItemActions>
    </Item>
  )
}
