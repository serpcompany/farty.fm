'use client'

import { Lock, Play, Square, XIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { SongSummary } from '@/lib/catalog/song'
import { pitchClass } from '@/lib/pitch'
import {
  type Coverage,
  coverageFraction,
  coverageSummary,
  missingNotes
} from '@/lib/pitch-coverage'
import { FavoriteButton } from './favorite-button'
import { usePedos } from './pedos-provider'
import { pianoSchedule } from './piano-preview'
import { PitchStrip } from './pitch-strip'
import { ReportSongButton } from './report-song-sheet'
import { type PianoPlaying, usePianoPreview } from './use-piano-preview'
import { useSongNotes } from './use-song-notes'

/**
 * What a locked Song still needs: its Pitch Coverage, the missing notes with their octave, and the
 * pitch strip with the needed pitch classes marked. A locked Song can't be played by farts, but
 * its melody plays on piano (#359), in the key the needed notes are named in. Matches the iPhone
 * app's `LockedSongSheet`, with the piano added.
 */
export function LockedSongSheet({
  song,
  onClose,
  onRecord,
  onReport
}: {
  /** The Song shown, or null when the sheet is closed. */
  song: SongSummary | null
  onClose: () => void
  /** Record: closes the sheet and switches to the Record tab. */
  onRecord: () => void
  /** Report a problem (#358): closes the sheet and opens the report sheet for its Song. */
  onReport: () => void
}) {
  const pedos = usePedos()
  // The last Song shown stays while the sheet slides away.
  const [shown, setShown] = useState(song)
  if (song !== null && song !== shown) setShown(song)
  // Read live, so a Recording analyzed while the sheet is open shows at once.
  const coverage = shown ? pedos.coverage(shown) : undefined
  const { song: melody } = useSongNotes(shown ?? undefined)
  const piano = usePianoPreview()
  const stopPiano = piano.stop
  // Closing the sheet stops the piano.
  useEffect(() => {
    if (song === null) stopPiano()
  }, [song, stopPiano])

  return (
    <Sheet open={song !== null} onOpenChange={open => !open && onClose()}>
      <SheetContent
        side="bottom"
        className="mx-auto min-h-[50dvh] max-w-md gap-0 rounded-t-2xl pb-[env(safe-area-inset-bottom)]"
        data-testid="locked-song-sheet"
        showCloseButton={false}
      >
        <SheetHeader className="items-center px-12 pt-4 pb-2">
          <SheetTitle className="text-center font-semibold">{shown?.title}</SheetTitle>
        </SheetHeader>
        {coverage && (
          <Body
            coverage={coverage}
            onRecord={onRecord}
            onReport={onReport}
            pianoPlaying={piano.playing}
            onPiano={
              melody &&
              (() => {
                if (piano.playing) piano.stop()
                // In the key the farts would play it in; as written before there are any.
                else piano.play('song', pianoSchedule(melody, pianoKey(coverage)))
              })
            }
          />
        )}
        {/* A locked Song can be a Favorite Song too (#313). */}
        {shown && <FavoriteButton song={shown} className="absolute top-1.5 left-1.5" />}
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

function Body({
  coverage,
  onRecord,
  onReport,
  pianoPlaying,
  onPiano
}: {
  coverage: Coverage
  onRecord: () => void
  onReport: () => void
  pianoPlaying: PianoPlaying | null
  /** Plays or stops the melody on piano; null until the Song's notes load. */
  onPiano: (() => void) | null
}) {
  const pedos = usePedos()
  const needed = new Set(coverage.missing.map(m => pitchClass(m.midi)))
  return (
    <div className="flex flex-1 flex-col gap-4 p-5">
      <div className="flex flex-col gap-1.5">
        <Progress value={coverageFraction(coverage) * 100} aria-hidden />
        <p className="flex items-center gap-2 text-muted-foreground">
          <Lock className="size-4" aria-hidden />
          {coverageSummary(coverage)}
        </p>
      </div>
      <PitchStrip collected={pedos.collectedPitchClasses} needed={needed} />
      <p className="text-xl" data-testid="locked-song-needs">
        {needs(coverage)}
      </p>
      <div className="flex-1" />
      <div className="flex flex-col gap-2">
        <Button
          variant="outline"
          size="lg"
          className="h-12 w-full text-base"
          disabled={onPiano === null}
          onClick={() => onPiano?.()}
          data-testid="locked-song-piano"
        >
          {pianoPlaying ? (
            <>
              <Square className="fill-current" />
              Stop
            </>
          ) : (
            <>
              <Play className="fill-current" />
              Play on piano
            </>
          )}
        </Button>
        <Button size="lg" className="h-12 w-full text-base" onClick={onRecord}>
          Record
        </Button>
      </div>
      <ReportSongButton className="-mt-2 self-center" onClick={onReport} />
    </div>
  )
}

/** "Needs a fart near D3 (0.5 s) and F3 (1.2 s).", or how to start without Melodic Recordings. */
function needs(coverage: Coverage): string {
  const missing = missingNotes(coverage)
  if (!coverage.hasMelodicRecordings || missing === null) {
    return 'Record a fart with a clear note to start.'
  }
  return `Needs a fart near ${missing}.`
}

/**
 * The key "Play on piano" plays a locked Song in: the one Auto-map would play it in with your
 * farts, or as written while you have none, since every key then ties and Auto-map takes the
 * lowest it tries, three octaves down.
 */
function pianoKey(coverage: Coverage): number {
  return coverage.hasMelodicRecordings ? coverage.transposition : 0
}
