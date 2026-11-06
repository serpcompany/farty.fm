'use client'

import { AudioLines, ListMusic, Play, Square } from 'lucide-react'
import Link from 'next/link'
import { type MouseEvent, type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { play, playbackPosition, stopPlayback } from '@/lib/audio/player'
import { formattedFartSeconds } from '@/lib/pitch-coverage'
import type { Trim } from '@/lib/recordings'
import { formattedTootDate, formattedTootLength, type TootRoll } from '@/lib/toot'
import { useInBrowser } from '@/lib/use-in-browser'
import { cn } from '@/lib/utils'
import { useWidth } from './note-view'
import { RollArt, usePlayingSeconds, useRollSong } from './profile-hero'
import { ReplayWaveform } from './waveform'

// A profile page's list of what its user shares (#448), each row laid out as SoundCloud's track
// row: a square picture (a Recording's note, a Toot's note roll), Play, a grey line over the name,
// the day and a tag at the right, then a waveform across the row, which shows how far it has
// played, its length and, while it plays, where it is, and plays from a tap. Each plays only that
// share's own audio. Under it, Copy link.

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
  /** "1.1 s", or "0:18". */
  length: string
  /** How long its audio is, in seconds. */
  seconds: number
  /** A Recording's loudness bars. Empty for a Toot, whose row fetches them. */
  levels: number[]
  /** The farts a Toot plays, by name. */
  farts: string[]
}

/** Where a play began: the banner's Play, or a row. Each says when its own play fails. */
export type PlaySource = 'hero' | 'row'

type Playing = { path: string; part: Trim; source: PlaySource }

/**
 * The page's playing, one share at a time, from its start or a spot in it. Each plays its own
 * audio, `<path>audio/`, under the key its own page plays it by.
 */
export function useProfilePlayer() {
  const [playing, setPlaying] = useState<Playing | null>(null)
  const [unplayable, setUnplayable] = useState<{ path: string; source: PlaySource } | null>(null)

  // Leaving the page stops it, as a tab change does in the app.
  useEffect(() => stopPlayback, [])

  const playFrom = useCallback((share: ProfileShare, from: number, source: PlaySource) => {
    const url = `${share.path}audio/`
    const next = {
      path: share.path,
      part: { startSeconds: from, endSeconds: share.seconds },
      source
    }
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
      from > 0 ? { start: from, end: share.seconds } : null,
      () => setPlaying(current => (current === next ? null : current))
    )
  }, [])

  const stop = useCallback(() => {
    stopPlayback()
    setPlaying(null)
  }, [])

  const toggle = (share: ProfileShare, source: PlaySource) => {
    if (playing?.path === share.path) stop()
    else playFrom(share, 0, source)
  }

  return { playing, unplayable, playFrom, stop, toggle }
}

export type ProfilePlayer = ReturnType<typeof useProfilePlayer>

/** As many bars as a shared Toot's are drawn in, flat, while its own load. */
const LOADING_BARS = Array<number>(60).fill(0.05)

/** About one bar to this many pixels of a row's waveform, as on a phone, however wide the row. */
const BAR_PIXELS = 6

/**
 * `levels` as `count` thinner bars, each the level where it falls between the two it lies
 * between: the same shape, so a computer's wide row doesn't draw a few fat bars. Never fewer.
 */
export function finerBars(levels: number[], count: number): number[] {
  if (levels.length < 2 || count <= levels.length) return levels
  const last = levels.length - 1
  return Array.from({ length: count }, (_, i) => {
    const at = Math.min(Math.max(((i + 0.5) * levels.length) / count - 0.5, 0), last)
    const below = Math.floor(at)
    const above = Math.min(below + 1, last)
    return levels[below] + (levels[above] - levels[below]) * (at - below)
  })
}

/** What a shared Toot's row draws, from its `row/`: its loudness bars and its note roll. */
export type TootRowArt = { levels: number[]; roll: TootRoll }

/** Each shared Toot's, fetched once a page load. */
const tootRows = new Map<string, Promise<TootRowArt>>()

const isLevels = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every(level => typeof level === 'number')

const isTootRowArt = (value: unknown): value is TootRowArt => {
  if (typeof value !== 'object' || value === null) return false
  const { levels, roll } = value as { levels?: unknown; roll?: unknown }
  return (
    isLevels(levels) &&
    typeof roll === 'object' &&
    roll !== null &&
    isLevels((roll as { played?: unknown }).played)
  )
}

/**
 * A shared Toot's bars and roll from its `row/`, once `wanted`; null until then, or when they
 * can't be had. The page never reads its Toots' audio or notes for them (ProfileItem's `levels`).
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

/** One tab's list, newest first. `handle` is whose page it is. */
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
    <ul className="divide-y overflow-hidden rounded-3xl bg-muted/60">
      {shares.map(share => (
        <ShareRow key={share.path} share={share} handle={handle} player={player} />
      ))}
    </ul>
  )
}

/** A label on the waveform, dark, as SoundCloud's: its length, and where it is while it plays. */
const onWaveform =
  'pointer-events-none absolute bottom-0 z-[4] rounded-sm bg-foreground/85 px-1 text-[11px] leading-4 font-medium text-background tabular-nums'

/**
 * A share's row, as SoundCloud's track row: its square picture; Play; over its name (a link to its
 * own page), the farts a Toot plays, or the Handle; at the right, the day it was shared and a
 * Recording's note or a Toot's Song; then its waveform; then Copy link.
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
  const byline =
    isToot && share.farts.length > 0 ? `Farts: ${share.farts.join(', ')}` : `@${handle}`
  const clock = (seconds: number) => {
    const here = Math.min(Math.max(seconds, 0), share.seconds)
    return isToot ? formattedTootLength(Math.floor(here)) : formattedFartSeconds(here)
  }

  return (
    <li
      ref={row}
      className="grid grid-cols-[4.25rem_minmax(0,1fr)] gap-x-3 gap-y-3 px-3 py-4 md:grid-cols-[8.75rem_minmax(0,1fr)] md:gap-x-5 md:px-5 md:py-5"
      data-testid="profile-shared-item"
    >
      <ShareArt share={share} roll={fetched?.roll ?? null} />
      <div className="flex min-w-0 items-start gap-2.5 md:gap-3">
        <button
          type="button"
          aria-label={playing ? `Stop ${share.name}` : `Play ${share.name}`}
          aria-pressed={playing !== null}
          onClick={() => player.toggle(share, 'row')}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <PlayIcon className="size-5 fill-current" aria-hidden />
        </button>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <p className="truncate text-xs text-muted-foreground" data-testid="profile-shared-byline">
            {byline}
          </p>
          <Link
            href={share.path}
            className="truncate rounded-sm font-semibold outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 md:text-[17px]"
            data-testid="profile-shared-link"
          >
            {share.name}
          </Link>
        </div>
        <div className="flex max-w-[40%] shrink-0 flex-col items-end gap-1.5">
          {/* Held at its size until the browser can say the day in the viewer's own time. */}
          <span
            className="min-h-4 text-xs leading-4 whitespace-nowrap text-muted-foreground"
            data-testid="profile-shared-date"
          >
            {date}
          </span>
          {share.detail && (
            <span
              className="max-w-full truncate rounded-full bg-muted-foreground/75 px-2 py-0.5 text-xs font-medium text-background"
              data-testid="profile-shared-tag"
            >
              {share.detail}
            </span>
          )}
        </div>
      </div>
      <div ref={wave} className="relative col-span-2 min-w-0 md:col-span-1 md:col-start-2">
        <ReplayWaveform
          levels={drawn}
          view={{ startSeconds: 0, endSeconds: share.seconds }}
          playing={playing}
          position={playbackPosition}
          label={`Play ${share.name} from a spot`}
          onScrubStart={player.stop}
          onPlayFrom={seconds => {
            if (share.seconds - seconds >= 0.02) player.playFrom(share, seconds, 'row')
          }}
          playedClassName="bg-brand-strong dark:bg-brand"
          className="h-14 md:h-[72px]"
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
 * A share's square picture, as a track's artwork: a Recording's note, big, or a Toot's note roll
 * once its row has it. A Noise-like Recording, which plays no note, and a Toot with no roll (its
 * Song isn't in Farty any more) show their kind's icon.
 */
function ShareArt({ share, roll }: { share: ProfileShare; roll: TootRoll | null }) {
  const song = useRollSong(roll)
  const noRoll = roll !== null && roll.song === null && roll.catalogSong === null
  return (
    <div
      aria-hidden
      className="relative size-[4.25rem] overflow-hidden rounded-xl bg-background md:row-span-3 md:size-[8.75rem] md:rounded-2xl"
      data-testid="profile-shared-art"
    >
      {share.kind === 'recordings' ? (
        share.detail ? (
          <span className="absolute inset-0 grid place-items-center text-2xl font-bold tracking-tight text-brand-strong tabular-nums md:text-5xl dark:text-brand">
            {share.detail}
          </span>
        ) : (
          <AudioLines className="absolute inset-0 m-auto size-7 text-muted-foreground md:size-12" />
        )
      ) : song ? (
        <div className="absolute inset-2 md:inset-4">
          <RollArt song={song} played={roll?.played ?? []} playing={false} />
        </div>
      ) : (
        noRoll && (
          <ListMusic className="absolute inset-0 m-auto size-7 text-muted-foreground md:size-12" />
        )
      )}
    </div>
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
