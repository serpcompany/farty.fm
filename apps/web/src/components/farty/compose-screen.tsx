'use client'

import { ArrowUpDown, ChevronRight, Heart, LayoutGrid, Lock, Music2, Search } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { memo, type ReactNode, useId, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { startAudioInTap } from '@/lib/audio/context'
import type { SongSummary } from '@/lib/catalog/song'
import {
  type Coverage,
  coverageFraction,
  coverageSummary,
  missingNotes,
  type SongRow,
  songListing,
  sortRows
} from '@/lib/pitch-coverage'
import { cn } from '@/lib/utils'
import { songOrders, useComposeChoices } from './compose-choices'
import { FavoriteButton, useFavorites } from './favorite-button'
import { LockedSongSheet } from './locked-song-sheet'
import { usePageHidden } from './page-hidden'
import { useRecordings } from './recordings-provider'
import { useSongCatalog } from './song-catalog-provider'
import { SongsFailed } from './songs-failed'
import { useNearViewport } from './use-near-viewport'

const noFavorites: ReadonlySet<string> = new Set()

export function ComposeScreen() {
  const { songRows, recordings, melodicRecordings, coverage } = useRecordings()
  const { songs, songsFailed } = useSongCatalog()
  const router = useRouter()
  const [query, setQuery] = useState('')
  const { order, chooseOrder, onlyFavorites, chooseOnlyFavorites } = useComposeChoices()
  const [lockedSong, setLockedSong] = useState<SongSummary | null>(null)
  const favorites = useFavorites()
  usePageHidden(() => setLockedSong(null))

  const sortFavorites = order === 'favoritesFirst' ? (favorites ?? noFavorites) : noFavorites
  const sorted = useMemo(
    () => sortRows(songRows, order, sortFavorites),
    [songRows, order, sortFavorites]
  )
  const only = onlyFavorites ? (favorites ?? noFavorites) : null
  const listing = useMemo(() => songListing(sorted, query, only), [sorted, query, only])
  const empty: 'none' | 'noFavorites' | 'noResults' =
    listing.unlocked.length > 0 || listing.locked.length > 0
      ? 'none'
      : onlyFavorites && query === ''
        ? 'noFavorites'
        : 'noResults'
  const showsAll = query === '' && !onlyFavorites

  return (
    <div className="flex flex-1 flex-col px-4 pb-6">
      <div className="flex items-center justify-between gap-2 pt-4 pb-3">
        <h1 className="text-3xl font-bold tracking-tight">Compose</h1>
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="icon"
            className="size-11 aria-pressed:bg-muted"
            aria-label="Favorites"
            aria-pressed={onlyFavorites}
            data-testid="favorites-filter"
            onClick={() => chooseOnlyFavorites(!onlyFavorites)}
          >
            <Heart className={cn(onlyFavorites && 'fill-current text-primary')} />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon" className="size-11" aria-label="Sort" />}
              data-testid="sort-songs"
            >
              <ArrowUpDown />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto">
              <DropdownMenuRadioGroup value={order} onValueChange={chooseOrder}>
                {songOrders.map(({ value, label }) => (
                  <DropdownMenuRadioItem key={value} value={value} className="py-2 text-base">
                    {label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="relative pb-4">
        <Search
          className="pointer-events-none absolute top-3.5 left-3 size-4 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          placeholder="Search Songs"
          aria-label="Search Songs"
          className="h-11 rounded-lg bg-muted/60 pl-9 text-base md:text-sm"
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
      </div>

      {songsFailed ? (
        <SongsFailed className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center" />
      ) : recordings === null || songs === null || favorites === null ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {showsAll && <SoundPadRow />}
          {melodicRecordings.length === 0 && showsAll && (
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
                <LockedSongRow
                  key={row.song.id}
                  row={row}
                  arranged={coverage}
                  onOpen={setLockedSong}
                />
              ))}
            </Section>
          )}
          {empty === 'noFavorites' && (
            <Empty className="pt-16" data-testid="no-favorites">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Heart />
                </EmptyMedia>
                <EmptyTitle>No Favorites yet</EmptyTitle>
                <EmptyDescription>
                  Tap the heart on a Song to add it to your Favorites.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {empty === 'noResults' && (
            <Empty className="pt-16">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Search />
                </EmptyMedia>
                <EmptyTitle>No Results for “{query}”</EmptyTitle>
                <EmptyDescription>Check the spelling or try a new search.</EmptyDescription>
              </EmptyHeader>
            </Empty>
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
      />
    </div>
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

function SoundPadRow() {
  return (
    <Link
      href="/compose/pad/"
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

const unlockedRow = 'flex items-center [content-visibility:auto] [contain-intrinsic-size:auto_49px]'
const lockedRow = 'flex items-center [content-visibility:auto] [contain-intrinsic-size:auto_107px]'

const UnlockedSongRow = memo(function UnlockedSongRow({ song }: { song: SongSummary }) {
  return (
    <li data-testid="song-row" data-song={song.id} className={unlockedRow}>
      <Link
        href={`/compose/${song.id}/`}
        onClick={startAudioInTap}
        className="flex min-h-11 min-w-0 flex-1 items-center justify-between gap-3 py-3 pr-1 pl-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset active:bg-muted"
      >
        <span>{song.title}</span>
        <span className="flex items-center gap-1 text-muted-foreground">
          Ready
          <ChevronRight className="size-4" aria-hidden />
        </span>
      </Link>
      <FavoriteButton song={song} className="mr-1" />
    </li>
  )
})

const LockedSongRow = memo(function LockedSongRow({
  row,
  arranged,
  onOpen
}: {
  row: SongRow
  arranged: (song: SongSummary) => Coverage
  onOpen: (song: SongSummary) => void
}) {
  const { song, coverage } = row
  const ref = useRef<HTMLLIElement>(null)
  const near = useNearViewport(ref)
  const missing = near ? missingNotes(arranged(song), 2) : null
  const needs = missing === null ? null : `Needs ${missing}`
  return (
    <li ref={ref} data-testid="song-row" data-song={song.id} className={lockedRow}>
      <button
        type="button"
        className="flex min-w-0 flex-1 items-baseline gap-3 py-3 pr-1 pl-4 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset active:bg-muted"
        onClick={() => onOpen(song)}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span>{song.title}</span>
          <Progress value={coverageFraction(coverage) * 100} aria-hidden />
          <span className="flex flex-col gap-0.5 text-sm text-muted-foreground">
            <span>{coverageSummary(coverage)}</span>
            {coverage.hasMelodicRecordings && <span>{needs ?? ' '}</span>}
          </span>
        </span>
        <Lock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="sr-only">Locked</span>
      </button>
      <FavoriteButton song={song} className="mr-1" />
    </li>
  )
})
