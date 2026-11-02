'use client'

import { Check, Flag, Link2Off, Play, Square } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
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
import { play, playbackPosition, stopPlayback } from '@/lib/audio/player'
import type { Trim } from '@/lib/recordings'
import { cn } from '@/lib/utils'
import { useAccount } from './account-provider'
import { ReplayWaveform } from './waveform'

// A shared Recording's page, `/u/<handle>/r/<id>/`, and a shared Toot's, `/u/<handle>/t/<id>/`
// (ADR 0020): what anyone with the link sees, signed in or not, in any browser. The fart comes
// first: who shared it, its name and its note or Song, a big waveform and Play. Get Farty sits
// under the player and in the top bar. The prototype's option A.

/** Farty's brand button, behind white text, as the lander's. */
const brand = 'bg-brand-strong text-white hover:bg-brand-strong/90'

/** Get Farty, or Open Farty for someone who already has an account. Both open Farty at `/`. */
function GetFarty({ className, big = false }: { className?: string; big?: boolean }) {
  const { account } = useAccount()
  const opens = account.status === 'signedIn'
  return (
    <Link
      href="/"
      className={cn(
        buttonVariants({ variant: opens ? 'outline' : 'default' }),
        !opens && brand,
        big ? 'h-12 px-7 text-base' : 'h-11 px-4 text-sm',
        className
      )}
    >
      {opens ? 'Open Farty' : 'Get Farty'}
    </Link>
  )
}

/** The page's own top bar: Farty, and Get Farty. The app's tabs aren't here. */
export function SharedTopBar() {
  return (
    <header className="flex min-h-14 items-center justify-between gap-3 px-4 py-1.5">
      <Link
        href="/"
        className="flex h-11 items-center gap-2.5 rounded-md text-lg font-bold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <Image
          src="/icons/icon-192.png"
          alt=""
          width={32}
          height={32}
          // A small static PNG; Workers has no image optimizer configured.
          unoptimized
          className="rounded-lg"
        />
        Farty
      </Link>
      <GetFarty />
    </header>
  )
}

export type SharedRecordingProps = {
  handle: string
  shareId: string
  name: string
  note: string | null
  length: string
  part: Trim
  levels: number[]
}

/** The shared Recording: who shared it, its name and note, the waveform, Play, Get Farty, Report. */
export function SharedRecordingPage({
  handle,
  shareId,
  name,
  note,
  ...player
}: SharedRecordingProps) {
  return (
    <SharedItemPage
      what="Recording"
      handle={handle}
      shareId={shareId}
      base={`/u/${handle}/r/${shareId}/`}
      name={name}
      {...player}
    >
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
    </SharedItemPage>
  )
}

export type SharedTootProps = {
  handle: string
  shareId: string
  title: string
  /** The Song it plays, or "Sound Pad", or null for a Song that isn't in Farty any more. */
  song: string | null
  /** "0:18". */
  length: string
  seconds: number
  levels: number[]
}

/** The shared Toot: who shared it, its title and Song, the waveform, Play, Get Farty, Report. */
export function SharedTootPage({
  handle,
  shareId,
  title,
  song,
  length,
  seconds,
  levels
}: SharedTootProps) {
  return (
    <SharedItemPage
      what="Toot"
      handle={handle}
      shareId={shareId}
      base={`/u/${handle}/t/${shareId}/`}
      name={title}
      length={length}
      part={{ startSeconds: 0, endSeconds: seconds }}
      levels={levels}
    >
      {song && (
        <p className="mt-1.5 text-[15px] text-muted-foreground" data-testid="shared-song">
          {song}
        </p>
      )}
    </SharedItemPage>
  )
}

/**
 * A shared item's page: who shared it, its name and `children` (a Recording's note, a Toot's Song),
 * the waveform and Play, Get Farty, and Report. `base` is the page's own path, which its audio and
 * Report are under.
 */
function SharedItemPage({
  what,
  handle,
  shareId,
  base,
  name,
  length,
  part,
  levels,
  children
}: {
  what: 'Recording' | 'Toot'
  handle: string
  shareId: string
  base: string
  name: string
  length: string
  part: Trim
  levels: number[]
  children?: ReactNode
}) {
  const { account } = useAccount()
  const [playing, setPlaying] = useState<Trim | null>(null)
  const [unplayable, setUnplayable] = useState(false)

  // Leaving the page stops it, as a tab change does in the app.
  useEffect(() => stopPlayback, [])

  const playFrom = useCallback(
    (from: number) => {
      const segment = { startSeconds: from, endSeconds: part.endSeconds }
      setPlaying(segment)
      setUnplayable(false)
      void play(
        `shared:${shareId}`,
        async () => {
          const response = await fetch(`${base}audio/`)
          if (!response.ok) {
            setUnplayable(true)
            throw new Error(`audio ${response.status}`)
          }
          return response.arrayBuffer()
        },
        { start: from, end: part.endSeconds },
        () => setPlaying(current => (current === segment ? null : current))
      )
    },
    [base, part.endSeconds, shareId]
  )

  const toggle = () => {
    if (playing) stopPlayback()
    else playFrom(part.startSeconds)
  }

  const PlayIcon = playing ? Square : Play
  return (
    <div className="flex flex-1 flex-col">
      <SharedTopBar />
      <div className="flex flex-1 flex-col px-4 pb-6">
        <p className="pt-3 text-[15px] text-muted-foreground">
          <span className="font-medium text-foreground">@{handle}</span> shared a {what}
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">{name}</h1>
        {children}

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
              onClick={toggle}
              className="flex size-16 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <PlayIcon className="size-6 fill-current" aria-hidden />
            </button>
            <div aria-hidden>
              <b className="block font-semibold">{playing ? 'Playing' : 'Play'}</b>
              <span className="text-sm text-muted-foreground tabular-nums">{length}</span>
            </div>
          </div>
          {unplayable && (
            <p role="alert" className="text-sm text-destructive">
              Couldn't play it. Check your connection and try again.
            </p>
          )}
        </div>

        {account.status !== 'signedIn' && (
          <div className="mt-5 grid gap-2 text-center">
            <GetFarty big />
            <p className="text-sm text-muted-foreground">
              Record your own farts and turn them into songs. Free, no app store.
            </p>
          </div>
        )}

        <div className="mt-7 flex justify-center">
          <Report what={what} action={`${base}report/`} />
        </div>
      </div>
    </div>
  )
}

/** Report, on every shared page: asks first, then sends it to Farty, who checks each one. */
function Report({ what, action }: { what: string; action: string }) {
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
            <AlertDialogTitle>Report this {what}?</AlertDialogTitle>
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
      <div className="grid justify-items-center gap-3 px-6 pt-28 text-center">
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
