'use client'

import { Lock, XIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { Song } from '@/lib/catalog/song'
import { pitchClass } from '@/lib/pitch'
import {
  type Coverage,
  coverageFraction,
  coverageSummary,
  missingNotes
} from '@/lib/pitch-coverage'
import { usePedos } from './pedos-provider'
import { PitchStrip } from './pitch-strip'

/**
 * What a locked Song still needs: its Pitch Coverage, the missing notes with their octave, and the
 * pitch strip with the needed pitch classes marked. A locked Song can't be played. Matches the
 * iPhone app's `LockedSongSheet`.
 */
export function LockedSongSheet({
  song,
  onClose,
  onRecord
}: {
  /** The Song shown, or null when the sheet is closed. */
  song: Song | null
  onClose: () => void
  /** Record: closes the sheet and switches to the Record tab. */
  onRecord: () => void
}) {
  const pedos = usePedos()
  // The last Song shown stays while the sheet slides away.
  const [shown, setShown] = useState(song)
  if (song !== null && song !== shown) setShown(song)
  // Read live, so a Recording analyzed while the sheet is open shows at once.
  const coverage = pedos.songRows.find(r => r.song.id === shown?.id)?.coverage

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
        {coverage && <Body coverage={coverage} onRecord={onRecord} />}
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

function Body({ coverage, onRecord }: { coverage: Coverage; onRecord: () => void }) {
  const pedos = usePedos()
  const needed = new Set(coverage.missing.map(pitchClass))
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
      <Button size="lg" className="h-12 w-full text-base" onClick={onRecord}>
        Record
      </Button>
    </div>
  )
}

/** "Needs a fart near D3 and F3.", or how to start without Melodic Recordings. */
function needs(coverage: Coverage): string {
  const missing = missingNotes(coverage)
  if (!coverage.hasMelodicRecordings || missing === null) {
    return 'Record a fart with a clear note to start.'
  }
  return `Needs a fart near ${missing}.`
}
