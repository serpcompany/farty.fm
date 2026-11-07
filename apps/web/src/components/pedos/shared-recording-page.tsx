'use client'

import { Check, ChevronRight, Flag, Link2Off, Play, Square } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button, buttonVariants } from '@/components/ui/button'
import { playbackPosition, stopPlayback } from '@/lib/audio/player'
import { type RecordedIn, recordedWhenAndWhere } from '@/lib/fart-place'
import { profilePath } from '@/lib/handle'
import type { Trim } from '@/lib/recordings'
import type { SharedTootParts as Parts } from '@/lib/toot'
import { useInBrowser } from '@/lib/use-in-browser'
import { cn } from '@/lib/utils'
import { useAccount } from './account-provider'
import { useStartGetFarty } from './get-farty'
import { SharedTootParts } from './shared-toot-parts'
import { SiteHeader } from './site-chrome'
import { useSharedPlayer } from './use-shared-player'
import { ReplayWaveform } from './waveform'

// A shared Recording's page, `/@<handle>/r/<slug>/`, and a shared Toot's, `/@<handle>/t/<slug>/`
// (ADR 0020): what anyone with the link sees, signed in or not, in any browser. The fart comes
// first: who shared it, its name and its note or Song, then a Recording's big waveform and Play,
// or the screen a Toot was made on (#451). Get Farty sits under the player and in the site's
// header. The prototype's option A.

/** A `/@<handle>/` page's column, under the site's header, which is wider. */
export const handlePageColumn = 'mx-auto flex w-full max-w-md flex-1 flex-col md:max-w-2xl md:pt-4'

/** Farty's brand button, behind white text, as the lander's. */
const brand = 'bg-brand-strong text-white hover:bg-brand-strong/90'

/**
 * Get Farty, or Open Farty for someone who already has an account, which opens Farty at `/`. Get
 * Farty offers `friend`, whoever's page it is, as a friend (#318).
 */
function GetFarty({
  friend = null,
  className,
  big = false
}: {
  friend?: string | null
  className?: string
  big?: boolean
}) {
  const { account } = useAccount()
  const size = big ? 'h-12 px-7 text-base' : 'h-11 px-4 text-sm'
  if (account.status === 'signedIn') {
    return (
      <Link href="/" className={cn(buttonVariants({ variant: 'outline' }), size, className)}>
        Open Farty
      </Link>
    )
  }
  return <GetFartyButton friend={friend} className={cn(brand, size, className)} />
}

function GetFartyButton({ friend, className }: { friend: string | null; className: string }) {
  const start = useStartGetFarty()
  return (
    <Button className={className} onClick={() => start(friend)}>
      Get Farty
    </Button>
  )
}

/**
 * The site's header on a `/@<handle>/` page: Farty, the lander's sections on a computer, whose
 * lander has them, and Get Farty, offering `friend`.
 */
export function SharedTopBar({ friend = null }: { friend?: string | null }) {
  return (
    <SiteHeader home="/" sectionsOn="/" sectionsClassName="hidden desktop:flex">
      <GetFarty friend={friend} />
    </SiteHeader>
  )
}

export type SharedRecordingProps = {
  handle: string
  slug: string
  name: string
  note: string | null
  length: string
  part: Trim
  levels: number[]
  /** When it was recorded, in ms. */
  recordedAt: number
} & RecordedIn

/**
 * The shared Recording: who shared it, its name and note, when and where it was recorded, the
 * waveform, Play, Get Farty, Report.
 */
export function SharedRecordingPage({
  handle,
  slug,
  name,
  note,
  recordedAt,
  recordedIn,
  timeZone,
  ...player
}: SharedRecordingProps) {
  const inBrowser = useInBrowser()
  const base = `${profilePath(handle)}r/${slug}/`
  return (
    <SharedItemPage
      what="Recording"
      handle={handle}
      base={base}
      name={name}
      details={
        <>
          {note && (
            <p className="mt-2.5">
              <span
                className="inline-block rounded-full bg-muted px-3 py-1 font-semibold tabular-nums"
                data-testid="shared-note"
              >
                {note}
              </span>
            </p>
          )}
          {/* Held at its size until the browser can say it in the viewer's own words. */}
          <p
            className="mt-2 min-h-5 text-sm text-muted-foreground tabular-nums"
            data-testid="shared-recorded-at"
          >
            {inBrowser && `Recorded ${recordedWhenAndWhere(recordedAt, { recordedIn, timeZone })}`}
          </p>
        </>
      }
    >
      <RecordingPlayer base={base} name={name} {...player} />
    </SharedItemPage>
  )
}

/** A shared Recording's big waveform, which can be tapped to play from a spot, and its Play. */
function RecordingPlayer({
  base,
  name,
  length,
  part,
  levels
}: {
  base: string
  name: string
  length: string
  part: Trim
  levels: number[]
}) {
  const { playFrom, sound, unplayable } = useSharedPlayer(base, part)
  const playing = sound?.of === 'item' ? sound.segment : null
  const PlayIcon = playing ? Square : Play

  return (
    <div className="mt-5 grid gap-4 rounded-3xl bg-muted/60 px-4 pt-5 pb-4">
      <ReplayWaveform
        levels={levels}
        view={part}
        playing={playing}
        position={playbackPosition}
        label={`Play ${name} from a spot`}
        onScrubStart={stopPlayback}
        onPlayFrom={seconds => {
          if (part.endSeconds - seconds >= 0.02) playFrom(seconds)
        }}
        className="h-[92px]"
      />
      <div className="flex items-center gap-3.5">
        <button
          type="button"
          aria-label={playing ? `Stop ${name}` : `Play ${name}`}
          aria-pressed={playing !== null}
          onClick={() => (playing ? stopPlayback() : playFrom(part.startSeconds))}
          className="flex size-16 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <PlayIcon className="size-6 fill-current" aria-hidden />
        </button>
        <div aria-hidden>
          <b className="block font-semibold">{playing ? 'Playing' : 'Play'}</b>
          <span className="text-sm text-muted-foreground tabular-nums" data-testid="shared-length">
            {length}
          </span>
        </div>
      </div>
      {unplayable === 'item' && (
        <p role="alert" className="text-sm text-destructive">
          Couldn't play it. Check your connection and try again.
        </p>
      )}
    </div>
  )
}

export type SharedTootProps = {
  handle: string
  slug: string
  title: string
  /** The Song it plays, or "Sound Pad", or null for a Song that isn't in Farty any more. */
  song: string | null
  /** "0:18". */
  length: string
  seconds: number
  /** What it's made of: its note roll, and each fart it plays. */
  parts: Parts
}

/**
 * The shared Toot: who shared it, its title and Song, then the screen it was made on (#451): Play,
 * its note roll and each fart. Then Get Farty, Report.
 */
export function SharedTootPage({
  handle,
  slug,
  title,
  song,
  length,
  seconds,
  parts
}: SharedTootProps) {
  const base = `${profilePath(handle)}t/${slug}/`
  return (
    <SharedItemPage
      what="Toot"
      handle={handle}
      base={base}
      name={title}
      details={
        song &&
        song !== title && (
          <p className="mt-1.5 text-[15px] text-muted-foreground" data-testid="shared-song">
            {song}
          </p>
        )
      }
    >
      <SharedTootParts
        handle={handle}
        base={base}
        title={title}
        length={length}
        seconds={seconds}
        parts={parts}
      />
    </SharedItemPage>
  )
}

/**
 * A shared item's page: who shared it, its name and `details` (a Recording's note, a Toot's Song),
 * then `children`, its player, then Get Farty and Report. `base` is the page's own path, which its
 * Report is under.
 */
function SharedItemPage({
  what,
  handle,
  base,
  name,
  details,
  children
}: {
  what: 'Recording' | 'Toot'
  handle: string
  base: string
  name: string
  details?: ReactNode
  children: ReactNode
}) {
  const { account } = useAccount()
  return (
    <div className="flex flex-1 flex-col">
      <SharedTopBar friend={handle} />
      <div className={cn(handlePageColumn, 'px-4 pb-6')}>
        <p className="pt-3 text-[15px] text-muted-foreground">
          <Link
            href={profilePath(handle)}
            className="rounded-sm font-medium text-foreground outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            @{handle}
          </Link>{' '}
          shared a {what}
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">{name}</h1>
        {details}

        {children}

        {account.status !== 'signedIn' && (
          <div className="mt-5 grid gap-2 text-center">
            <GetFarty friend={handle} big />
            <p className="text-sm text-muted-foreground">
              Record your own farts and turn them into songs. Free, no app store.
            </p>
          </div>
        )}

        <Link
          href={profilePath(handle)}
          className="mt-6 flex min-h-11 items-center justify-center gap-1 rounded-md text-[15px] font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          More from @{handle}
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        </Link>

        <div className="mt-3 flex justify-center">
          <Report what={what} action={`${base}report/`} />
        </div>
      </div>
    </div>
  )
}

/**
 * Report, on every shared page and profile page: asks first ("Report this Recording?", or
 * `title`), then sends it to Farty, who checks each one.
 */
export function Report({ what, title, action }: { what?: string; title?: string; action: string }) {
  const [asking, setAsking] = useState(false)
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed' | 'limited'>('idle')

  if (state === 'sent') {
    return (
      <output className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground">
        <Check className="size-3.5" aria-hidden />
        Reported. Thanks.
      </output>
    )
  }
  return (
    <div className="grid justify-items-center">
      <Button
        variant="ghost"
        className="h-11 gap-1.5 text-sm font-normal text-muted-foreground"
        onClick={() => setAsking(true)}
      >
        <Flag className="size-3.5" aria-hidden />
        Report
      </Button>
      {state === 'failed' && (
        <p role="alert" className="text-sm text-destructive">
          Couldn't send the report. Check your connection and try again.
        </p>
      )}
      {state === 'limited' && (
        <p role="alert" className="text-sm text-destructive">
          Too many reports right now. Try again later.
        </p>
      )}
      <AlertDialog open={asking} onOpenChange={open => state !== 'sending' && setAsking(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title ?? `Report this ${what}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              Farty checks every report and takes down anything that breaks the rules.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 text-base" disabled={state === 'sending'}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-11 text-base"
              disabled={state === 'sending'}
              onClick={async () => {
                setState('sending')
                const response = await fetch(action, { method: 'POST' }).catch(() => null)
                setAsking(false)
                setState(response?.ok ? 'sent' : response?.status === 429 ? 'limited' : 'failed')
              }}
            >
              Report
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** A link that doesn't work: never shared, stopped, taken down, or deleted. */
export function SharedLinkGone() {
  return (
    <div className="flex flex-1 flex-col">
      <SharedTopBar />
      <div className="grid justify-items-center gap-3 px-6 pt-28 pb-16 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Link2Off className="size-7" aria-hidden />
        </span>
        <h1 className="text-[22px] font-bold tracking-tight">This link doesn't work any more</h1>
        <p className="text-muted-foreground">It was taken down or deleted.</p>
        <GetFarty big className="mt-3 w-full max-w-xs" />
      </div>
    </div>
  )
}
