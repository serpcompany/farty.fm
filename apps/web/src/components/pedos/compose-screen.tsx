'use client'

import {
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Heart,
  LayoutGrid,
  Lock,
  Music2,
  Search,
  X
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { memo, type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { startAudioInTap } from '@/lib/audio/context'
import type { SongSummary } from '@/lib/catalog/song'
import { type CoverageCount, type SongRow, songListing, sortRows } from '@/lib/pitch-coverage'
import { cn } from '@/lib/utils'
import { songOrders, useComposeChoices } from './compose-choices'
import { FavoriteButton, useFavorites } from './favorite-button'
import { LockedSongSheet } from './locked-song-sheet'
import { usePedos } from './pedos-provider'
import { ReportSongSheet } from './report-song-sheet'

const noFavorites: ReadonlySet<string> = new Set()

/**
 * Compose: the Song Catalog with each Song's Pitch Coverage. Search it by title or composer, sort
 * it, and show only the Ready or Favorite Songs (#356). Open an Unlocked Song in Song Creator, or a
 * locked Song to see which notes it still needs. Matches the iPhone app's `ComposeTab`.
 */
export function ComposeScreen() {
  const pedos = usePedos()
  const router = useRouter()
  const [query, setQuery] = useState('')
  const searchBox = useRef<HTMLInputElement>(null)
  const { order, chooseOrder, onlyFavorites, chooseOnlyFavorites, onlyReady, chooseOnlyReady } =
    useComposeChoices()
  const [lockedSong, setLockedSong] = useState<SongSummary | null>(null)
  /** The Song a locked sheet's Report a problem opened the report sheet for (#358). */
  const [reportedSong, setReportedSong] = useState<SongSummary | null>(null)
  const favorites = useFavorites()

  // The page comes back on the Record tab, so the sheet doesn't stay open.
  useEffect(() => {
    const visibilityChanged = () => {
      if (document.visibilityState === 'hidden') setLockedSong(null)
    }
    document.addEventListener('visibilitychange', visibilityChanged)
    return () => document.removeEventListener('visibilitychange', visibilityChanged)
  }, [])

  const sorted = useMemo(() => sortRows(pedos.songRows, order), [pedos.songRows, order])
  // A heart tap filters again only while the Favorites filter is on.
  const only = onlyFavorites ? (favorites ?? noFavorites) : null
  const listing = useMemo(
    () => songListing(sorted, query, { ready: onlyReady, favorites: only }),
    [sorted, query, onlyReady, only]
  )
  // The whole catalog, or the search within it: the Sound Pad and the first steps show with it.
  const showsAll = query === '' && !onlyFavorites && !onlyReady
  const orderLabel = (songOrders.find(o => o.value === order) ?? songOrders[0]).label
  const showAll = () => {
    chooseOnlyReady(false)
    chooseOnlyFavorites(false)
  }

  return (
    <div className="flex flex-1 flex-col px-4 pb-6">
      <h1 className="pt-4 pb-1 text-3xl font-bold tracking-tight">Compose</h1>

      {/* Search and the chips stay in reach while the list scrolls. */}
      <div className="sticky top-[env(safe-area-inset-top)] z-10 -mx-4 flex flex-col gap-1 bg-background/95 px-4 pt-1.5 pb-1 backdrop-blur md:top-16">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-3.5 left-3 size-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            ref={searchBox}
            type="search"
            placeholder="Search Songs or composers"
            aria-label="Search Songs or composers"
            className="h-11 rounded-lg bg-muted/60 pr-11 pl-9 text-base md:text-sm [&::-webkit-search-cancel-button]:hidden"
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
          {query !== '' && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-0 right-0 size-11 text-muted-foreground hover:bg-transparent"
              aria-label="Clear search"
              onClick={() => {
                setQuery('')
                searchBox.current?.focus()
              }}
            >
              <X className="size-4.5" />
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className={cn(chip, 'shrink')}
                  aria-label={`Sort: ${orderLabel}`}
                />
              }
              data-testid="sort-songs"
            >
              <span className={chipFace}>
                <ArrowUpDown className="size-4 shrink-0" aria-hidden />
                <span className="truncate">{orderLabel}</span>
                <ChevronDown className="size-4 shrink-0" aria-hidden />
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-auto">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={order} onValueChange={chooseOrder}>
                  {songOrders.map(({ value, label }) => (
                    <DropdownMenuRadioItem
                      key={value}
                      value={value}
                      closeOnClick
                      className="py-2 text-base"
                    >
                      {label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            className={chip}
            aria-pressed={onlyReady}
            data-testid="ready-filter"
            onClick={() => chooseOnlyReady(!onlyReady)}
          >
            <span className={chipFace}>Ready</span>
          </button>
          <button
            type="button"
            className={cn(chip, 'w-11')}
            aria-label="Favorites"
            aria-pressed={onlyFavorites}
            data-testid="favorites-filter"
            onClick={() => chooseOnlyFavorites(!onlyFavorites)}
          >
            <span className={cn(chipFace, 'w-11 justify-center px-0')}>
              <Heart className={cn('size-4', onlyFavorites && 'fill-current')} aria-hidden />
            </span>
          </button>
        </div>
      </div>

      {pedos.songsFailed ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-muted-foreground">Couldn't load the Songs.</p>
          <Button variant="outline" className="h-11 px-5 text-base" onClick={pedos.reloadSongs}>
            Try again
          </Button>
        </div>
      ) : pedos.recordings === null || pedos.songs === null || favorites === null ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : (
        <div className="flex flex-col gap-6 pt-1.5">
          {showsAll && <SoundPadRow />}
          {pedos.melodicRecordings.length === 0 && showsAll && (
            <Empty className="rounded-xl bg-muted/60 p-6">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Music2 />
                </EmptyMedia>
                <EmptyTitle>No Melodic Recordings yet</EmptyTitle>
                <EmptyDescription>
                  Record a few farts with a clear note to start unlocking Songs.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {listing.unlocked.length > 0 && (
            <Section title={`Unlocked · ${listing.unlocked.length}`} testId="unlocked-songs">
              {listing.unlocked.map(row => (
                <UnlockedSongRow key={row.song.id} song={row.song} />
              ))}
            </Section>
          )}
          {listing.locked.length > 0 && (
            <Section title={`Locked · ${listing.locked.length}`} testId="locked-songs">
              {listing.locked.map(row => (
                <LockedSongRow key={row.song.id} row={row} onOpen={setLockedSong} />
              ))}
            </Section>
          )}
          {listing.unlocked.length === 0 && listing.locked.length === 0 && (
            <NoSongs
              query={query.trim()}
              onlyReady={onlyReady}
              onlyFavorites={onlyFavorites}
              hasFavorites={(favorites?.size ?? 0) > 0}
              onShowAll={showAll}
            />
          )}
        </div>
      )}

      <LockedSongSheet
        song={lockedSong}
        onClose={() => setLockedSong(null)}
        onRecord={() => {
          setLockedSong(null)
          router.push('/')
        }}
        onReport={() => {
          setReportedSong(lockedSong)
          setLockedSong(null)
        }}
      />
      <ReportSongSheet song={reportedSong} onClose={() => setReportedSong(null)} />
    </div>
  )
}

// A chip: a 34 px pill in a 44 px-high tap area. It fills while it's on (`aria-pressed`), and
// greys while its menu is open.
const chip = 'group flex h-11 min-w-0 shrink-0 items-center outline-none'
const chipFace =
  'flex h-[34px] min-w-0 items-center gap-1.5 rounded-full border border-border px-3 text-sm whitespace-nowrap transition-colors group-hover:bg-muted group-focus-visible:ring-3 group-focus-visible:ring-ring/50 group-aria-expanded:bg-muted group-aria-pressed:border-primary group-aria-pressed:bg-primary group-aria-pressed:text-primary-foreground'

/**
 * What Compose says when it lists no Song: why, and a way to show the Songs a filter hides, when
 * there are any.
 */
function NoSongs({
  query,
  onlyReady,
  onlyFavorites,
  hasFavorites,
  onShowAll
}: {
  query: string
  onlyReady: boolean
  onlyFavorites: boolean
  hasFavorites: boolean
  onShowAll: () => void
}) {
  const filters = [onlyReady && 'Ready', onlyFavorites && 'Favorite'].filter(Boolean)
  const [icon, title, description, action]: [ReactNode, string, string, string?] =
    query !== ''
      ? filters.length === 0
        ? [
            <Search key="icon" />,
            `No Results for “${query}”`,
            'Check the spelling or try a new search.'
          ]
        : [
            <Search key="icon" />,
            `No ${filters.join(' ')} Songs match “${query}”`,
            'The filters are on. Search every Song instead.',
            'Search all Songs'
          ]
      : onlyFavorites && (!hasFavorites || !onlyReady)
        ? [
            <Heart key="icon" />,
            'No Favorites yet',
            'Tap the heart on a Song to add it to your Favorites.',
            onlyReady ? 'Show all Songs' : undefined
          ]
        : onlyFavorites
          ? [
              <CircleCheck key="icon" />,
              'No Ready Favorites',
              'None of your Favorites is unlocked yet.',
              'Show all Songs'
            ]
          : [
              <CircleCheck key="icon" />,
              'No Ready Songs yet',
              'Record a few farts with a clear note to unlock a Song.',
              'Show all Songs'
            ]
  return (
    <Empty className="pt-16" data-testid="no-songs">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action && (
        <EmptyContent>
          <Button variant="outline" className="h-11 px-5 text-base" onClick={onShowAll}>
            {action}
          </Button>
        </EmptyContent>
      )}
    </Empty>
  )
}

function Section({
  title,
  testId,
  children
}: {
  title: string
  testId: string
  children: ReactNode
}) {
  const id = useId()
  return (
    <section aria-labelledby={id} data-testid={testId}>
      <h2 id={id} className="px-4 pb-1.5 text-xs font-normal text-muted-foreground">
        {title}
      </h2>
      <ul className="divide-y overflow-hidden rounded-xl bg-muted/60">{children}</ul>
    </section>
  )
}

/** The Sound Pad's way in (#277), above the Songs: it plays any Recording, so it's never locked. */
function SoundPadRow() {
  return (
    <Link
      href="/compose/pad/"
      // A Pad plays on the press, which a touch browser doesn't count as a tap that starts audio.
      onClick={startAudioInTap}
      className="flex min-h-11 items-center gap-3 rounded-xl bg-muted/60 px-4 py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:bg-muted"
    >
      <LayoutGrid className="size-5 shrink-0 text-primary" aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col">
        <span>Sound Pad</span>
        <span className="text-sm text-muted-foreground">Tap your farts to play them</span>
      </span>
      <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
    </Link>
  )
}

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

/** How long a Song plays, in whole seconds, at its own tempo. */
const seconds = (song: SongSummary) => Math.round((song.lengthBeats * 60) / song.bpm)

/**
 * A Song's three lines: its title, its composer when known, and its facts. A locked Song's facts
 * start with its Pitch Coverage: "3 of 4 notes · 84 BPM · 11 s". Shown, not read: a screen reader
 * reads `songDescription` instead.
 */
function SongLines({ song, coverage }: { song: SongSummary; coverage?: CoverageCount }) {
  const notes = song.pitches.length
  return (
    <span className="flex min-w-0 flex-1 flex-col" aria-hidden>
      <span className="truncate">{song.title}</span>
      {song.composer !== undefined && (
        <span className="truncate text-sm text-muted-foreground">{song.composer}</span>
      )}
      <span className="truncate text-sm text-muted-foreground tabular-nums">
        {coverage ? (
          <span className="text-foreground">
            {coverage.covered} of {notes} notes
          </span>
        ) : (
          `${notes} notes`
        )}
        {` · ${song.bpm} BPM · ${seconds(song)} s`}
      </span>
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

/** An Unlocked Song: its three lines and a chevron. It opens in Song Creator. */
const UnlockedSongRow = memo(function UnlockedSongRow({ song }: { song: SongSummary }) {
  const descriptionId = useId()
  return (
    <li data-testid="song-row" data-song={song.id} className={cn(songRow, rowHeight(song))}>
      <Link
        href={`/compose/${song.id}/`}
        // Song Creator plays the Toot once it's made: the tap starts the sound it needs.
        onClick={startAudioInTap}
        className={rowTarget}
        aria-label={song.title}
        aria-describedby={descriptionId}
      >
        <SongLines song={song} />
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
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
const LockedSongRow = memo(function LockedSongRow({
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
