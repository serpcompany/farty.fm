'use client'

import { ChevronRight, Lock, LockOpen } from 'lucide-react'
import Link from 'next/link'
import { type CSSProperties, memo, useId } from 'react'
import { startAudioInTap } from '@/lib/audio/context'
import type { SongSummary } from '@/lib/catalog/song'
import type { CoverageCount, SongRow } from '@/lib/pitch-coverage'
import { cn } from '@/lib/utils'
import { FavoriteButton } from './favorite-button'

// Compose's Song rows (#356), which the Result's reward lists too (#363).

/** The card a list of Song rows sits in, with a line between rows. */
export const songList = 'divide-y overflow-hidden rounded-xl bg-muted/60'

// A row off the screen skips its layout and paint, and keeps the room it last took, or a row's
// before it's first on screen: 84 px with a composer line, 64 without. With 1,000 Songs, laying
// out every row was most of the time Compose took to open, search and scroll (#323).
const songRow = 'flex items-center [content-visibility:auto]'
const rowHeight = (song: SongSummary) =>
  song.composer === undefined
    ? '[contain-intrinsic-size:auto_64px]'
    : '[contain-intrinsic-size:auto_84px]'
const rowTarget =
  'flex min-w-0 flex-1 items-center gap-3 py-2.5 pr-1 pl-4 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset active:bg-muted'
const factsLine = 'truncate text-sm text-muted-foreground tabular-nums'

/** How long a Song plays, in whole seconds, at its own tempo. */
const seconds = (song: SongSummary) => Math.round((song.lengthBeats * 60) / song.bpm)

/** "3 of 4 notes", the start of a locked Song's facts. */
function Covered({ covered, notes }: { covered: number; notes: number }) {
  return (
    <span className="text-foreground">
      {covered} of {notes} notes
    </span>
  )
}

/**
 * A Song's three lines: its title, its composer when known, and its facts. A locked Song's facts
 * start with its Pitch Coverage: "3 of 4 notes · 84 BPM · 11 s". With `unlockedFrom`, the line
 * holds both, the locked one hidden, and the unlocking row's animation flips from one to the
 * other (#363). Shown, not read: a screen reader reads `songDescription` instead.
 */
function SongLines({
  song,
  coverage,
  unlockedFrom
}: {
  song: SongSummary
  coverage?: CoverageCount
  unlockedFrom?: CoverageCount
}) {
  const notes = song.pitches.length
  const rest = ` · ${song.bpm} BPM · ${seconds(song)} s`
  return (
    <span className="flex min-w-0 flex-1 flex-col" aria-hidden>
      <span className="truncate">{song.title}</span>
      {song.composer !== undefined && (
        <span className="truncate text-sm text-muted-foreground">{song.composer}</span>
      )}
      {unlockedFrom ? (
        <span className="grid grid-cols-1 overflow-hidden">
          <span
            className={cn(
              factsLine,
              'col-start-1 row-start-1 opacity-0 motion-safe:animate-unlock-before'
            )}
          >
            <Covered covered={unlockedFrom.covered} notes={notes} />
            {rest}
          </span>
          <span
            className={cn(factsLine, 'col-start-1 row-start-1 motion-safe:animate-unlock-after')}
          >
            {`${notes} notes${rest}`}
          </span>
        </span>
      ) : (
        <span className={factsLine}>
          {coverage ? <Covered covered={coverage.covered} notes={notes} /> : `${notes} notes`}
          {rest}
        </span>
      )}
    </span>
  )
}

/** What a screen reader reads after a Song row's title. */
function songDescription(song: SongSummary, coverage?: CoverageCount): string {
  const notes = song.pitches.length
  const covered = coverage ? `${coverage.covered} of ${notes} notes covered` : `${notes} notes`
  return [
    coverage && 'Locked',
    song.composer,
    `${covered}, ${song.bpm} BPM, ${seconds(song)} seconds`
  ]
    .filter(Boolean)
    .join('. ')
}

const sparkAngles = Array.from({ length: 8 }, (_, k) => k * 45 + 12)

/**
 * Eight dots that fly out from the middle of their parent and fade, `radius` px out, as a lock
 * opens (#363). Hidden at rest, so with reduced motion there are none.
 */
export function Sparks({ radius, className }: { radius: number; className: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute top-1/2 left-1/2"
      style={{ '--r': `${radius}px` } as CSSProperties}
    >
      {sparkAngles.map(angle => (
        <span
          key={angle}
          className={cn(
            'absolute -top-[2.5px] -left-[2.5px] size-[5px] rounded-full bg-brand-strong opacity-0 dark:bg-brand',
            className
          )}
          style={{ '--a': `${angle}deg` } as CSSProperties}
        />
      ))}
    </span>
  )
}

/**
 * The unlocking row's end: its lock wiggles and gives way to an open lock in pink with sparks,
 * which gives way to the chevron. At rest only the chevron shows (#363).
 */
function OpeningLock() {
  const icon = 'col-start-1 row-start-1 size-4'
  return (
    <span className="relative grid size-4 shrink-0 text-muted-foreground" aria-hidden>
      <Lock className={cn(icon, 'opacity-0 motion-safe:animate-unlock-lock')} />
      <LockOpen
        className={cn(
          icon,
          'text-brand-strong opacity-0 motion-safe:animate-unlock-open dark:text-brand'
        )}
      />
      <ChevronRight className={cn(icon, 'motion-safe:animate-unlock-chevron')} />
      <Sparks radius={18} className="motion-safe:animate-unlock-row-spark" />
    </span>
  )
}

/**
 * An Unlocked Song: its three lines and a chevron. It opens in Song Creator, or with `onOpen`, a
 * tap calls it instead, as the Result's reward does (#363). With `unlocking`, it first shows as the
 * locked row it was before a save, with that Pitch Coverage, then opens its lock `delayMs` after
 * it first shows: once, behind `motion-safe`, and it rests on the Unlocked row.
 */
export const UnlockedSongRow = memo(function UnlockedSongRow({
  song,
  onOpen,
  unlocking
}: {
  song: SongSummary
  onOpen?: (song: SongSummary) => void
  unlocking?: { before: CoverageCount; delayMs: number }
}) {
  const descriptionId = useId()
  return (
    <li
      data-testid="song-row"
      data-song={song.id}
      className={cn(songRow, rowHeight(song), unlocking && 'motion-safe:animate-unlock-flash')}
      style={unlocking && ({ '--d': `${unlocking.delayMs}ms` } as CSSProperties)}
    >
      <Link
        href={`/compose/${song.id}/`}
        onClick={event => {
          // Song Creator plays the Toot once it's made: the tap starts the sound it needs.
          startAudioInTap()
          if (!onOpen) return
          event.preventDefault()
          onOpen(song)
        }}
        className={rowTarget}
        aria-label={song.title}
        aria-describedby={descriptionId}
      >
        <SongLines song={song} unlockedFrom={unlocking?.before} />
        {unlocking ? (
          <OpeningLock />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <span id={descriptionId} className="sr-only">
          {songDescription(song)}
        </span>
      </Link>
      <FavoriteButton song={song} className="mr-1" />
    </li>
  )
})

/**
 * A locked Song: its three lines, its facts starting with its Pitch Coverage, and a lock. It opens
 * the locked-Song sheet, which shows the notes it still needs.
 */
export const LockedSongRow = memo(function LockedSongRow({
  row,
  onOpen
}: {
  row: SongRow
  onOpen: (song: SongSummary) => void
}) {
  const { song, coverage } = row
  const descriptionId = useId()
  return (
    <li data-testid="song-row" data-song={song.id} className={cn(songRow, rowHeight(song))}>
      <button
        type="button"
        className={rowTarget}
        aria-label={song.title}
        aria-describedby={descriptionId}
        onClick={() => onOpen(song)}
      >
        <SongLines song={song} coverage={coverage} />
        <Lock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span id={descriptionId} className="sr-only">
          {songDescription(song, coverage)}
        </span>
      </button>
      <FavoriteButton song={song} className="mr-1" />
    </li>
  )
})
