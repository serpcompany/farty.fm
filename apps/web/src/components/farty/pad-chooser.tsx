'use client'

import { Check, XIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { formattedFartLength } from '@/lib/pitch-coverage'
import { type Recording, recordingName } from '@/lib/recordings'
import { cn } from '@/lib/utils'
import { describePadRecording, padNote } from './pad'

export function PadChooser({
  pad,
  current,
  recordings,
  onChoose,
  onClose
}: {
  pad: number | null
  current: string | null
  recordings: readonly Recording[]
  onChoose: (id: string) => void
  onClose: () => void
}) {
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
                  aria-label={describePadRecording(recording, [
                    recordingName(recording),
                    padNote(recording),
                    formattedFartLength(recording)
                  ])}
                  className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset active:bg-muted"
                  onClick={() => onChoose(recording.id)}
                >
                  <span className="font-semibold">{recordingName(recording)}</span>{' '}
                  <span className="flex items-center gap-2 text-muted-foreground tabular-nums">
                    {padNote(recording)} <span>{formattedFartLength(recording)}</span>
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
