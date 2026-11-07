'use client'

import { Play, Square } from 'lucide-react'
import Link from 'next/link'
import { type MouseEvent, type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { play, playbackPosition, stopPlayback } from '@/lib/audio/player'
import { formattedFartSeconds } from '@/lib/pitch-coverage'
import type { Trim } from '@/lib/recordings'
import { formattedTootDate, formattedTootLength } from '@/lib/toot'
import { useInBrowser } from '@/lib/use-in-browser'
import { cn } from '@/lib/utils'
import { finerBars } from '@/lib/waveform'
import { useWidth } from './note-view'
import { usePlayingSeconds } from './profile-hero'
import { ReplayWaveform } from './waveform'

// A profile page's list of what its user shares (#448, #451), each row laid out as SoundCloud's
// track row without its artwork: Play at the left, the Handle over the name, as SoundCloud's
// uploader, the day and a pill at the top right, then a waveform drawn as SoundCloud's, which shows
// how far it has played, its length and, while it plays, where it is, and plays from a tap. Each
// plays only that share's own audio. Under it, Copy link.

/** A Recording or Toot its user shares, as their page lists it. Never where it was made. */
export type ProfileShare = {
  kind: 'recordings' | 'toots'
  /** Its shared page, which its audio is under: a Recording's and a Toot's differ by kind. */
  path: string
  name: string
  /** A Recording's note, or a Toot's Song when that isn't its name. */
  detail: string | null
  /** When it was shared, in ms. */
  sharedAt: number
  /** "1.1 s", a Recording's fart's length, as its own page prints it, or "0:18". */
  length: string
  /** What its row plays, draws and times, in seconds of its audio: a Recording's fart, a Toot. */
  part: Trim
  /** A Recording's loudness bars, of its fart. Empty for a Toot, whose row fetches them. */
  levels: number[]
}

/** Where a play began: the banner's Play, or a row. Each says when its own play fails. */
export type PlaySource = 'hero' | 'row'

type Playing = { path: string; part: Trim; source: PlaySource }

/**
 * The page's playing, one share at a time, from its start or a spot in it, to its `part`'s end.
 * Each plays its own audio, `<path>audio/`, under the key its own page plays it by.
 */
export function useProfilePlayer() {
  const [playing, setPlaying] = useState<Playing | null>(null)
  const [unplayable, setUnplayable] = useState<{ path: string; source: PlaySource } | null>(null)

  // Leaving the page stops it, as a tab change does in the app.
  useEffect(() => stopPlayback, [])

  const playFrom = useCallback((share: ProfileShare, from: number, source: PlaySource) => {
    const url = `${share.path}audio/`
    const { endSeconds } = share.part
    const next = { path: share.path, part: { startSeconds: from, endSeconds }, source }
    const failed = () => setUnplayable({ path: share.path, source })
    setPlaying(next)
    setUnplayable(null)
    void play(
      `shared:${url}`,
      async () => {
        const response = await fetch(url).catch(error => {
          failed()
          throw error
        })
        if (!response.ok) {
          failed()
          throw new Error(`audio ${response.status}`)
        }
        return response.arrayBuffer()
      },
      // A Toot plays to its audio's end. A Recording plays only its fart, a trim (ADR 0004).
      share.kind === 'recordings' || from > 0 ? { start: from, end: endSeconds } : null,
      () => setPlaying(current => (current === next ? null : current))
    )
  }, [])

  const stop = useCallback(() => {
    stopPlayback()
    setPlaying(null)
  }, [])

  const toggle = (share: ProfileShare, source: PlaySource) => {
    if (playing?.path === share.path) stop()
    else playFrom(share, share.part.startSeconds, source)
  }

  return { playing, unplayable, playFrom, stop, toggle }
}

export type ProfilePlayer = ReturnType<typeof useProfilePlayer>

/** As many bars as a shared Toot's are drawn in, flat, while its own load. */
const LOADING_BARS = Array<number>(60).fill(0.05)

/** One bar to this many pixels of a row's waveform, however wide the row: SoundCloud's thin bars. */
const BAR_PIXELS = 4

/** What a shared Toot's row draws, from its `row/`: its loudness bars. */
export type TootRowArt = { levels: number[] }

/** Each shared Toot's, fetched once a page load. */
const tootRows = new Map<string, Promise<TootRowArt>>()

const isLevels = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every(level => typeof level === 'number')

const isTootRowArt = (value: unknown): value is TootRowArt =>
  typeof value === 'object' && value !== null && isLevels((value as { levels?: unknown }).levels)

/**
 * A shared Toot's bars from its `row/`, once `wanted`; null until then, or when they can't be
 * had. The page never reads its Toots' audio for them (ProfileItem's `levels`).
 */
export function useTootRow(path: string, wanted: boolean): TootRowArt | null {
  const [loaded, setLoaded] = useState<{ path: string; art: TootRowArt } | null>(null)
  useEffect(() => {
    if (!wanted) return
    let loading = tootRows.get(path)
    if (!loading) {
      const started = fetch(`${path}row/`)
        .then(response => (response.ok ? response.json() : null))
        .then(art => {
          if (!isTootRowArt(art)) throw new Error('no row')
          return art
        })
      tootRows.set(path, started)
      // A failed load is tried again on the next view of the page.
      started.catch(() => {
        if (tootRows.get(path) === started) tootRows.delete(path)
      })
      loading = started
    }
    let live = true
    loading.then(
      art => live && setLoaded({ path, art }),
      () => {}
    )
    return () => {
      live = false
    }
  }, [path, wanted])
  return loaded?.path === path ? loaded.art : null
}

/** Whether the element has come near the screen yet, so a long list loads its rows' bars as read. */
function useSeen(element: RefObject<HTMLElement | null>): boolean {
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const target = element.current
    if (seen || !target) return
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true)
      return
    }
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) setSeen(true)
      },
      { rootMargin: '400px 0px' }
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [element, seen])
  return seen
}

/** One tab's list, newest first, its rows apart as SoundCloud's are. `handle`: whose page. */
export function ShareList({
  shares,
  handle,
  player
}: {
  shares: ProfileShare[]
  handle: string
  player: ProfilePlayer
}) {
  return (
    <ul className="flex flex-col gap-8 md:gap-10">
      {shares.map(share => (
        <ShareRow key={share.path} share={share} handle={handle} player={player} />
      ))}
    </ul>
  )
}

/**
 * A label on the waveform's line, dark, as SoundCloud's: its length at the right and, while it
 * plays, where it is at the left.
 */
const onWaveform =
  'pointer-events-none absolute bottom-[calc(30%+2px)] z-[4] rounded-sm bg-foreground/85 px-1 text-xs leading-4 font-medium text-background tabular-nums'

/**
 * A share's row, as SoundCloud's track row with no artwork (the owner, #451): Play at its left
 * edge, and over its name (a link to its own page) the Handle, as SoundCloud's uploader; at the
 * top right, the day it was shared and a Recording's note (a Toot's Song, when that isn't its
 * name) as a pill; then its waveform, as SoundCloud draws one, with its length at the right; then
 * Copy link.
 */
function ShareRow({
  share,
  handle,
  player
}: {
  share: ProfileShare
  handle: string
  player: ProfilePlayer
}) {
  const row = useRef<HTMLLIElement>(null)
  const wave = useRef<HTMLDivElement>(null)
  const inBrowser = useInBrowser()
  const isToot = share.kind === 'toots'
  const seen = useSeen(row)
  const fetched = useTootRow(share.path, isToot && seen)
  const levels = isToot ? (fetched?.levels ?? null) : share.levels
  const width = useWidth(wave)
  const drawn = finerBars(
    levels && levels.length > 0 ? levels : LOADING_BARS,
    Math.floor(width / BAR_PIXELS)
  )
  const playing = player.playing?.path === share.path ? player.playing.part : null
  const at = usePlayingSeconds(playing !== null)
  const PlayIcon = playing ? Square : Play
  // Only in the browser, so it's the viewer's own day.
  const date = inBrowser ? formattedTootDate(share.sharedAt) : null
  const { part } = share
  // From the fart's start, and never past its end, so it reads the length at its end.
  const clock = (seconds: number) => {
    const here = Math.min(
      Math.max(seconds - part.startSeconds, 0),
      part.endSeconds - part.startSeconds
    )
    return isToot ? formattedTootLength(Math.floor(here)) : formattedFartSeconds(here)
  }

  return (
    <li
      ref={row}
      className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-3 gap-y-3"
      data-testid="profile-shared-item"
    >
      <button
        type="button"
        aria-label={playing ? `Stop ${share.name}` : `Play ${share.name}`}
        aria-pressed={playing !== null}
        onClick={() => player.toggle(share, 'row')}
        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <PlayIcon className="size-5 fill-current" aria-hidden />
      </button>
      <div className="flex min-w-0 items-start gap-3">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <p className="truncate text-sm text-muted-foreground" data-testid="profile-shared-byline">
            @{handle}
          </p>
          <Link
            href={share.path}
            className="line-clamp-3 rounded-sm leading-snug font-semibold outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 md:line-clamp-2"
            data-testid="profile-shared-link"
          >
            {share.name}
          </Link>
        </div>
        <div className="flex max-w-[40%] shrink-0 flex-col items-end gap-1.5">
          {/* Held at its size until the browser can say the day in the viewer's own time. */}
          <span
            className="min-h-5 text-xs leading-5 whitespace-nowrap text-muted-foreground"
            data-testid="profile-shared-date"
          >
            {date}
          </span>
          {share.detail && (
            <Badge
              variant="secondary"
              className="max-w-full truncate tabular-nums"
              data-testid="profile-shared-tag"
            >
              {share.detail}
            </Badge>
          )}
        </div>
      </div>
      <div ref={wave} className="relative col-span-2 min-w-0 md:col-span-1 md:col-start-2">
        <ReplayWaveform
          levels={drawn}
          view={part}
          playing={playing}
          position={playbackPosition}
          label={`Play ${share.name} from a spot`}
          onScrubStart={player.stop}
          onPlayFrom={seconds => {
            if (part.endSeconds - seconds >= 0.02) player.playFrom(share, seconds, 'row')
          }}
          playedClassName="bg-brand-strong dark:bg-brand"
          reflected
          className="h-16 md:h-[88px]"
        />
        {at !== null && (
          <span className={cn(onWaveform, 'left-0')} data-testid="profile-shared-time">
            {clock(at)}
          </span>
        )}
        <span className={cn(onWaveform, 'right-0')} data-testid="profile-shared-length">
          {share.length}
        </span>
      </div>
      <div className="col-span-2 grid gap-1 md:col-span-1 md:col-start-2">
        {player.unplayable?.path === share.path && player.unplayable.source === 'row' && (
          <p role="alert" className="text-sm text-destructive">
            Couldn't play it. Check your connection and try again.
          </p>
        )}
        <CopyLink path={share.path} />
      </div>
    </li>
  )
}

/**
 * Copy link: a plain link to the share's own page, which a tap copies instead of opening, and says
 * so. Where the clipboard can't be written, it says to press and hold the link, which copies it.
 */
function CopyLink({ path }: { path: string }) {
  const [said, setSaid] = useState<'copied' | 'failed' | null>(null)
  useEffect(() => {
    if (!said) return
    const timer = setTimeout(() => setSaid(null), 2500)
    return () => clearTimeout(timer)
  }, [said])

  const copy = (event: MouseEvent<HTMLAnchorElement>) => {
    // A click with a modifier key opens it, in a new tab or window, as any link's does.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    const url = new URL(path, window.location.origin).href
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(url))
      .then(
        () => setSaid('copied'),
        () => setSaid('failed')
      )
  }

  return (
    <p className="flex min-w-0 flex-wrap items-baseline gap-x-3 text-sm">
      <a
        href={path}
        onClick={copy}
        className="rounded-sm font-medium text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        data-testid="profile-copy-link"
      >
        Copy link
      </a>
      <span aria-live="polite" className="text-muted-foreground" data-testid="profile-copy-said">
        {said === 'copied' && 'Link copied'}
        {said === 'failed' && "Couldn't copy it. Press and hold Copy link to copy it."}
      </span>
    </p>
  )
}
