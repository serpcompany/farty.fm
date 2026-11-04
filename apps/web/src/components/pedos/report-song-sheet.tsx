'use client'

import { CircleCheck, Flag, XIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import type { SongSummary } from '@/lib/catalog/song'
import {
  SONG_REPORT_NOTE_MAX,
  SONG_REPORT_REASONS,
  type SongReportReason,
  type SongReportResult,
  sendSongReport
} from '@/lib/song-report'
import { cn } from '@/lib/utils'

// Report a Song that's wrong (#358): at the end of Song Creator and on a locked Song's sheet. A
// reason, an optional note, and Send, which keeps it in D1 for Farty to fix the catalog by
// (docs/agents/web.md, Reports and take-downs). Guests can report, and nothing about who sent it
// is kept.

/** Report a problem: opens the report sheet. */
export function ReportSongButton({
  onClick,
  className
}: {
  onClick: () => void
  className?: string
}) {
  return (
    <Button
      variant="ghost"
      className={cn('h-11 gap-1.5 text-sm font-normal text-muted-foreground', className)}
      onClick={onClick}
    >
      <Flag className="size-3.5" aria-hidden />
      Report a problem
    </Button>
  )
}

/** Report a problem and its own sheet, for Song Creator. */
export function ReportSong({ song }: { song: SongSummary }) {
  const [isOpen, setIsOpen] = useState(false)
  return (
    <>
      <ReportSongButton className="self-center" onClick={() => setIsOpen(true)} />
      <ReportSongSheet song={isOpen ? song : null} onClose={() => setIsOpen(false)} />
    </>
  )
}

/**
 * The report sheet: what's wrong with `song`, a note, and Send; then the thank-you. Each opening
 * starts a new report.
 */
export function ReportSongSheet({
  song,
  onClose
}: {
  /** The Song reported, or null when the sheet is closed. */
  song: SongSummary | null
  onClose: () => void
}) {
  // The last Song shown stays while the sheet slides away.
  const [shown, setShown] = useState(song)
  if (song !== null && song !== shown) setShown(song)
  // Each opening is a new report.
  const isOpen = song !== null
  const [wasOpen, setWasOpen] = useState(isOpen)
  const [opening, setOpening] = useState(0)
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen)
    if (isOpen) setOpening(n => n + 1)
  }

  return (
    <Sheet open={isOpen} onOpenChange={open => !open && onClose()}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[90dvh] min-h-[50dvh] max-w-md gap-0 rounded-t-2xl pb-[env(safe-area-inset-bottom)]"
        data-testid="report-song-sheet"
        showCloseButton={false}
      >
        {shown && <ReportForm key={opening} song={shown} />}
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

const PROBLEMS: Record<Exclude<SongReportResult, 'sent'>, string> = {
  failed: "Couldn't send the report. Check your connection and try again.",
  limited: 'Too many reports right now. Try again later.'
}

function ReportForm({ song }: { song: SongSummary }) {
  const ids = useId()
  const [reason, setReason] = useState<SongReportReason | null>(null)
  const [note, setNote] = useState('')
  const [state, setState] = useState<SongReportResult | 'idle' | 'sending'>('idle')

  if (state === 'sent') {
    return (
      <>
        <div className="flex flex-col items-center gap-2.5 px-6 pt-10 pb-2 text-center">
          <CircleCheck className="size-12" aria-hidden />
          <SheetTitle className="text-xl font-semibold">Thanks, we'll take a look.</SheetTitle>
          <SheetDescription className="text-base">{song.title}</SheetDescription>
        </div>
        <SheetFooter className="px-4 pb-5">
          <SheetClose render={<Button size="lg" className="h-12 w-full text-base" />}>
            Done
          </SheetClose>
        </SheetFooter>
      </>
    )
  }

  const isSending = state === 'sending'
  const send = async () => {
    if (reason === null || isSending) return
    setState('sending')
    setState(await sendSongReport(song, reason, note))
  }
  return (
    <>
      <SheetHeader className="items-center px-14 pt-4 pb-1.5 text-center">
        <SheetTitle className="font-semibold">Report a problem</SheetTitle>
        <SheetDescription>{song.title}</SheetDescription>
      </SheetHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-4 py-2">
        <div>
          <h3 id={`${ids}-why`} className="px-4 pb-1.5 text-xs font-normal text-muted-foreground">
            What's wrong?
          </h3>
          <RadioGroup
            aria-labelledby={`${ids}-why`}
            value={reason}
            onValueChange={value => setReason(value as SongReportReason)}
            disabled={isSending}
            className="gap-0 divide-y overflow-hidden rounded-xl bg-muted/60"
          >
            {SONG_REPORT_REASONS.map(({ id, label }) => (
              <label
                key={id}
                htmlFor={`${ids}-${id}`}
                className="flex min-h-[50px] cursor-pointer items-center justify-between gap-3 px-4 text-base leading-snug select-none"
              >
                {label}
                <RadioGroupItem id={`${ids}-${id}`} value={id} className="size-5" />
              </label>
            ))}
          </RadioGroup>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${ids}-note`} className="px-4 text-xs text-muted-foreground">
            Add a note (optional)
          </label>
          <Textarea
            id={`${ids}-note`}
            value={note}
            onChange={event => setNote(event.target.value)}
            maxLength={SONG_REPORT_NOTE_MAX}
            disabled={isSending}
            placeholder="Which notes, or where in the Song"
            className="min-h-[92px] resize-none text-base md:text-base"
          />
          <p className="text-right text-xs text-muted-foreground tabular-nums" aria-hidden>
            {note.length}/{SONG_REPORT_NOTE_MAX}
          </p>
        </div>
      </div>
      <SheetFooter className="mt-0 border-t px-4 pt-2.5 pb-5">
        {(state === 'failed' || state === 'limited') && (
          <p role="alert" className="text-center text-sm text-destructive">
            {PROBLEMS[state]}
          </p>
        )}
        <Button
          size="lg"
          className="h-12 w-full text-base"
          disabled={reason === null || isSending}
          onClick={send}
        >
          {isSending ? (
            <>
              <Spinner aria-hidden className="size-5" />
              Sending…
            </>
          ) : (
            'Send'
          )}
        </Button>
      </SheetFooter>
    </>
  )
}
