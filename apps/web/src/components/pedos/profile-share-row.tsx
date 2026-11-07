'use client'

import { Play, Square } from 'lucide-react'
import Link from 'next/link'
import {
  type CSSProperties,
  type MouseEvent,
  memo,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { Badge } from '@/components/ui/badge'
import { play, playbackPosition, stopPlayback } from '@/lib/audio/player'
import type { SongSummary } from '@/lib/catalog/song'
import { formattedFartSeconds } from '@/lib/pitch-coverage'
import type { Trim } from '@/lib/recordings'
import {
  formattedTootDate,
  formattedTootLength,
  type RollSong,
  type RowNote,
  rowNotes
} from '@/lib/toot'
import { useInBrowser } from '@/lib/use-in-browser'
import { cn } from '@/lib/utils'
import { finerBars, timelineAt } from '@/lib/waveform'
import { Layout, pitchColor } from './note-view'
import { usePlayingSeconds, useRollSong } from './profile-hero'
import { ReplayWaveform } from './waveform'

// A profile page's list of what its user shares (#448, #451), each row laid out as SoundCloud's
// track row without its artwork: Play at the left, the Handle over the name, as SoundCloud's
// uploader, and under it a dot for each fart in its color, with how many (#457); the day and a
// pill at the right, then a waveform drawn as SoundCloud's, which shows how far it has played, its
// length and, while it plays, where it is, and plays from a tap. Over the waveform, a Toot's notes
// or a Recording's one note, on the waveform's own timeline (#459). Each plays only that share's
// own audio. Under it, Copy link.

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
  /**
   * A Recording's note, as a MIDI note number, drawn as a line across its waveform (#459): null
   * when it has none, and for a Toot, whose row fetches its notes with its bars.
   */
  pitch: number | null
  /** How many farts it plays: a Recording 1, a Toot its "Recordings used" rows. */
  farts: number
  /**
   * Its first 16 farts' colors (`pitchColor`), in its "Recordings used" order: only where each
   * comes among its pitches, never which fart it is.
   */
  fartColors: number[]
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

/**
 * One bar to this many pixels of a row's waveform, however wide the row: SoundCloud's thin
 * bars.
 */
const BAR_PIXELS = 4

/**
 * What a shared Toot's row draws, from its `row/` (`ProfileTootRow`): its loudness bars, and its
 * notes as heard (#459), or for a Toot saved before #254 its Song in the catalog to fetch them
 * from, with the pitches a fart plays.
 */
export type TootRowArt = {
  levels: number[]
  notes: RowNote[] | null
  catalog: { song: SongSummary; played: number[] } | null
}

/** Each shared Toot's, fetched once a page load. */
const tootRows = new Map<string, Promise<TootRowArt>>()

const isLevels = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every(level => typeof level === 'number')

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isRowNote = (value: unknown): value is RowNote =>
  isRecord(value) &&
  ['start', 'length', 'pitch', 'color'].every(field => typeof value[field] === 'number')

const isCatalog = (value: unknown): value is TootRowArt['catalog'] & object =>
  isRecord(value) &&
  isRecord(value.song) &&
  typeof value.song.id === 'string' &&
  typeof value.song.notesPath === 'string' &&
  isLevels(value.played)

/** A `row/`'s answer as its row draws it, or null when it isn't one: with no notes it can't read. */
function tootRowArt(value: unknown): TootRowArt | null {
  if (!isRecord(value) || !isLevels(value.levels)) return null
  const { levels, notes, catalog } = value
  return {
    levels,
    notes: Array.isArray(notes) && notes.every(isRowNote) ? notes : null,
    catalog: isCatalog(catalog) ? catalog : null
  }
}

/**
 * A shared Toot's bars and notes from its `row/`, once `wanted`; null until then, or when they
 * can't be had. The page never reads its Toots' audio for them (ProfileItem's `levels`).
 */
export function useTootRow(path: string, wanted: boolean): TootRowArt | null {
  const [loaded, setLoaded] = useState<{ path: string; art: TootRowArt } | null>(null)
  useEffect(() => {
    if (!wanted) return
    let loading = tootRows.get(path)
    if (!loading) {
      const started = fetch(`${path}row/`)
        .then(response => (response.ok ? response.json() : null))
        .then(answer => {
          const art = tootRowArt(answer)
          if (!art) throw new Error('no row')
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

/**
 * A Toot row's notes to draw (#459): the ones its `row/` sent, or for a Toot saved before #254,
 * its Song's notes as they are now, fetched as its page fetches them (`useRollSong`) and placed by
 * the same rule (`rowNotes`). Null while they load, or with none: its Song isn't in Farty any more.
 */
function useRowNotes(art: TootRowArt | null): RowNote[] | null {
  const catalog = art?.catalog ?? null
  const roll = useMemo(
    () => (catalog ? { song: null, catalogSong: catalog.song, played: catalog.played } : null),
    [catalog]
  )
  const song = useRollSong(roll)
  return useMemo(() => {
    if (art?.notes) return art.notes
    return song && catalog ? rowNotes(song, catalog.played) : null
  }, [art, song, catalog])
}

/** The element's size in pixels, kept current as it resizes. */
function useSize(element: RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 })
  // Before the first paint, so the bars and notes never show squeezed at the left.
  useLayoutEffect(() => {
    const target = element.current
    if (!target) return
    const measure = () => {
      const width = target.clientWidth
      const height = target.clientHeight
      setSize(last => (last.width === width && last.height === height ? last : { width, height }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(target)
    return () => observer.disconnect()
  }, [element])
  return size
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

/** "1 fart", "40 farts". */
const fartCount = (farts: number) => `${farts} ${farts === 1 ? 'fart' : 'farts'}`

/**
 * A share's farts at a glance (#457): a dot in each one's color, as its own page colors its
 * "Recordings used" rows, then how many, which says them all when there are more than its dots.
 * The dots are only a picture: the count is what a screen reader says.
 */
function FartDots({ farts, colors }: { farts: number; colors: number[] }) {
  return (
    <p
      className="flex min-w-0 items-center gap-1.5 text-sm leading-5 text-muted-foreground"
      data-testid="profile-shared-farts"
    >
      <span aria-hidden className="flex shrink-0 items-center gap-[3px]">
        {colors.map((color, index) => (
          <span
            // Two farts can share a color, and a row's never reorder.
            // biome-ignore lint/suspicious/noArrayIndexKey: a share's farts are fixed
            key={index}
            className="size-2 rounded-full"
            style={{ backgroundColor: pitchColor(color) }}
            data-testid="profile-shared-dot"
          />
        ))}
      </span>
      <span className="truncate tabular-nums" data-testid="profile-shared-fart-count">
        {fartCount(farts)}
      </span>
    </p>
  )
}

/**
 * A note's or the line's colors over the waveform (#459, the owner's "A1 + sound"): its fart's,
 * `--c`, or ahead of the playhead `--dim`, a solid pale tint of it so the bars don't show through,
 * and a thin edge in the page's color, so it reads over grey bars and played ones alike. `--dim`
 * is set on the element that sets `--c`: a custom property's `var()` resolves where it's declared.
 */
const NOTE_DIM =
  '[--dim:color-mix(in_srgb,var(--c)_42%,var(--background))] dark:[--dim:color-mix(in_srgb,var(--c)_55%,var(--background))]'
const NOTE_EDGE = 'shadow-[0_0_0_1.5px_var(--background)]'

/** Where a note is as its row plays: heard (or stopped), playing now, or not reached yet. */
type NoteState = 'heard' | 'now' | 'ahead'

function noteState(note: RowNote, at: number | null): NoteState {
  if (at === null) return 'heard'
  if (note.start > at) return 'ahead'
  return at < note.start + note.length ? 'now' : 'heard'
}

const NOTE_STATE: Record<NoteState, string> = {
  heard: cn('bg-(--c)', NOTE_EDGE),
  ahead: cn('bg-(--dim)', NOTE_EDGE),
  // A ring in its own color, over the notes beside it.
  now: 'z-[1] bg-(--c) shadow-[0_0_0_1.5px_var(--background),0_0_0_3.5px_var(--c)]'
}

/** A state as one letter, so a row's states are one string to compare frame to frame. */
const STATE_LETTER: Record<NoteState, string> = { heard: 'h', now: 'n', ahead: 'a' }
const LETTER_STATE: Record<string, NoteState> = { h: 'heard', n: 'now', a: 'ahead' }

/**
 * Each note's state with the playhead at `at`, as the same array until one of them changes: the
 * clock moves every frame, but a note's state only a few times a second, so a frame that changes
 * none redraws no note.
 */
function useNoteStates(notes: readonly RowNote[] | null, at: number | null): readonly NoteState[] {
  const letters = (notes ?? []).map(note => STATE_LETTER[noteState(note, at)]).join('')
  return useMemo(() => [...letters].map(letter => LETTER_STATE[letter]), [letters])
}

/**
 * The notes a row draws: only those that start before its audio ends. A Toot saved before #254
 * draws its Song's notes as they are now, and the Song may have grown since.
 */
function notesInPart(notes: readonly RowNote[] | null, part: Trim): RowNote[] | null {
  return notes ? notes.filter(note => note.start < part.endSeconds) : null
}

/**
 * A Toot's notes as a roll of seconds, a beat to each, so the Toot page's `Layout` places them
 * on its row's timeline: pitch up, the lowest and highest the row draws one note from its edges.
 */
function secondsRoll(notes: readonly RowNote[], part: Trim): RollSong {
  return {
    bpm: 60,
    length_beats: part.endSeconds - part.startSeconds,
    notes: notes.map(note => ({
      start: note.start - part.startSeconds,
      dur: note.length,
      pitch: note.pitch
    })),
    pitches: [...new Set(notes.map(note => note.pitch))].sort((a, b) => a - b)
  }
}

/** One note over the waveform, redrawn only when its state or place changes. */
const RowNoteMark = memo(function RowNoteMark({
  color,
  left,
  top,
  width,
  height,
  state
}: {
  color: number
  left: string
  top: string
  width: string
  height: string
  state: NoteState
}) {
  return (
    <span
      className={cn('absolute rounded-full', NOTE_DIM, NOTE_STATE[state])}
      style={{ '--c': pitchColor(color), left, top, width, height } as CSSProperties}
      data-state={state}
      data-testid="profile-shared-note"
    />
  )
})

/**
 * A Toot's notes over its waveform, the full height of it, each where it's heard (#459): its
 * left edge where the playhead is as it plays, both from `timelineAt`, and sized and colored as on
 * the Toot's own page (`Layout`, `pitchColor`), never past the waveform's right edge. While it
 * plays, the notes the playhead has passed are in full color, the one playing has a ring, and the
 * ones ahead are dimmed; stopped, all are in full color. Only a picture: taps go through to the
 * waveform. `notes` are `notesInPart`'s, and `states` `useNoteStates`'s, one to each.
 */
const RowNotes = memo(function RowNotes({
  notes,
  part,
  size,
  states
}: {
  notes: RowNote[]
  part: Trim
  size: { width: number; height: number }
  states: readonly NoteState[]
}) {
  const places = useMemo(() => {
    const roll = secondsRoll(notes, part)
    const layout = new Layout(roll, size.width, size.height)
    return notes.map((note, index) => {
      const { y, width, height } = layout.rect(roll.notes[index])
      const x = timelineAt(note.start, part)
      return {
        left: `${(x * 100).toFixed(3)}%`,
        top: `${y.toFixed(2)}px`,
        // A short note near the end is still at least as wide as it's tall: never past the edge.
        width: `${Math.min(width, size.width * (1 - x)).toFixed(2)}px`,
        height: `${height.toFixed(2)}px`
      }
    })
  }, [notes, part, size.width, size.height])
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-[2]"
      data-testid="profile-shared-notes"
    >
      {notes.map((note, index) => (
        <RowNoteMark
          // A Toot's notes are fixed, and two can start together.
          // biome-ignore lint/suspicious/noArrayIndexKey: a Toot's notes never reorder
          key={index}
          color={note.color}
          {...places[index]}
          state={states[index] ?? 'heard'}
        />
      ))}
    </div>
  )
})

/**
 * A Recording's one note as a line across its waveform (#459), in its fart's color as its dot:
 * higher for a higher note, from C2 at the bottom to C4 at the top, or across the middle for a
 * Noise-like one. While it plays, it fills in up to the playhead, and is dimmed ahead of it.
 */
function RecordingLine({
  pitch,
  part,
  at
}: {
  pitch: number | null
  part: Trim
  at: number | null
}) {
  const high = pitch === null ? 0.5 : Math.min(1, Math.max(0, (pitch - 36) / 24))
  const filled = at === null ? 100 : Math.min(1, Math.max(0, timelineAt(at, part))) * 100
  return (
    <span
      aria-hidden
      className={cn(
        'absolute inset-x-0 z-[2] h-1.5 rounded-full top-[calc((100%_-_6px)_*_var(--k))] md:h-2 md:top-[calc((100%_-_8px)_*_var(--k))]',
        'bg-[linear-gradient(90deg,var(--c)_var(--at),var(--dim)_var(--at))]',
        'pointer-events-none',
        NOTE_DIM,
        NOTE_EDGE
      )}
      style={
        {
          '--c': pitchColor(0),
          '--k': (1 - high).toFixed(3),
          '--at': `${filled.toFixed(3)}%`
        } as CSSProperties
      }
      data-testid="profile-shared-line"
    />
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
 * edge, and beside it the Handle over its name (a link to its own page), as SoundCloud's uploader;
 * at the right, the day it was shared and a Recording's note (a Toot's Song, when that isn't its
 * name) as a pill; under them its farts as dots, with how many (#457); then its waveform, as
 * SoundCloud draws one, with its length at the right; then Copy link. The Handle and a one-line
 * name, and the day with its pill, sit level with Play; a longer name grows down, and the day
 * stays at the top. The dots take the row's width, so 16 of them fit beside a long pill.
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
  const fetchedNotes = useRowNotes(isToot ? fetched : null)
  const size = useSize(wave)
  const drawn = finerBars(
    levels && levels.length > 0 ? levels : LOADING_BARS,
    Math.floor(size.width / BAR_PIXELS)
  )
  const playing = player.playing?.path === share.path ? player.playing.part : null
  const at = usePlayingSeconds(playing !== null)
  const { part } = share
  const notes = useMemo(() => notesInPart(fetchedNotes, part), [fetchedNotes, part])
  const states = useNoteStates(notes, at)
  const PlayIcon = playing ? Square : Play
  // Only in the browser, so it's the viewer's own day.
  const date = inBrowser ? formattedTootDate(share.sharedAt) : null
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
      <div className="grid min-w-0 gap-1">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-0.5">
            <p
              className="truncate text-sm leading-5 text-muted-foreground"
              data-testid="profile-shared-byline"
            >
              @{handle}
            </p>
            <Link
              href={share.path}
              className="line-clamp-3 min-w-0 rounded-sm leading-snug font-semibold outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 md:line-clamp-2"
              data-testid="profile-shared-link"
            >
              {share.name}
            </Link>
          </div>
          <div className="flex min-h-11 max-w-[40%] shrink-0 flex-col items-end justify-center gap-1.5">
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
                className="max-w-full tabular-nums"
                data-testid="profile-shared-tag"
              >
                {/* Its own box, so a long Song ends in an ellipsis: the Badge centers its text. */}
                <span className="min-w-0 truncate">{share.detail}</span>
              </Badge>
            )}
          </div>
        </div>
        <FartDots farts={share.farts} colors={share.fartColors} />
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
          // Fainter than a waveform alone, so the notes over it read first (#459).
          barClassName="bg-muted-foreground/38 dark:bg-muted-foreground/32"
          reflected
          className="h-16 md:h-[88px]"
        />
        {isToot ? (
          notes &&
          notes.length > 0 &&
          size.width > 0 &&
          size.height > 0 && <RowNotes notes={notes} part={part} size={size} states={states} />
        ) : (
          <RecordingLine pitch={share.pitch} part={part} at={at} />
        )}
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
