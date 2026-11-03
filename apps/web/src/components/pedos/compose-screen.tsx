'use client'

import { ArrowUpDown, ChevronRight, Heart, LayoutGrid, Lock, Music2, Search } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type ReactNode, useEffect, useId, useMemo, useState } from 'react'
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
import type { Song } from '@/lib/catalog/song'
import {
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
import { usePedos } from './pedos-provider'

const noFavorites: ReadonlySet<string> = new Set()

/**
 * Compose: the Song Catalog with each Song's Pitch Coverage. Open an Unlocked Song in Song
 * Creator, or a locked Song to see which notes it still needs. Matches the iPhone app's
 * `ComposeTab`.
 */
export function ComposeScreen() {
  const pedos = usePedos()
  const router = useRouter()
  const [query, setQuery] = useState('')
  const { order, chooseOrder, onlyFavorites, chooseOnlyFavorites } = useComposeChoices()
  const [lockedSong, setLockedSong] = useState<Song | null>(null)
  const favorites = useFavorites()

  // The page comes back on the Record tab, so the sheet doesn't stay open.
  useEffect(() => {
    const visibilityChanged = () => {
      if (document.visibilityState === 'hidden') setLockedSong(null)
    }
    document.addEventListener('visibilitychange', visibilityChanged)
    return () => document.removeEventListener('visibilitychange', visibilityChanged)
  }, [])

  // A heart tap sorts and filters again only when the order or the filter uses the favorites.
  const sortFavorites = order === 'favoritesFirst' ? (favorites ?? noFavorites) : noFavorites
  const sorted = useMemo(
    () => sortRows(pedos.songRows, order, sortFavorites),
    [pedos.songRows, order, sortFavorites]
  )
  const only = onlyFavorites ? (favorites ?? noFavorites) : null
  const listing = useMemo(() => songListing(sorted, query, only), [sorted, query, only])
  const empty: 'none' | 'noFavorites' | 'noResults' =
    listing.unlocked.length > 0 || listing.locked.length > 0
      ? 'none'
      : onlyFavorites && query === ''
        ? 'noFavorites'
        : 'noResults'
  // The whole catalog, or the search within it: the Sound Pad and the first steps show with it.
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
        <div className="flex flex-col gap-6">
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
                <LockedSongRow key={row.song.id} row={row} onOpen={() => setLockedSong(row.song)} />
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

/** An Unlocked Song: its title and "Ready". It opens in Song Creator. */
function UnlockedSongRow({ song }: { song: Song }) {
  return (
    <li data-testid="song-row" data-song={song.id} className="flex items-center">
      <Link
        href={`/compose/${song.id}/`}
        // Song Creator plays the Toot once it's made: the tap starts the sound it needs.
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
}

/**
 * A locked Song: its title, a Pitch Coverage bar, a lock and the lowest missing notes, with how
 * long a fart each needs. Two of them, so "Needs …" stays on one line on a phone.
 */
function LockedSongRow({ row, onOpen }: { row: SongRow; onOpen: () => void }) {
  const { song, coverage } = row
  const valueId = useId()
  const missing = missingNotes(coverage, 2)
  const needs = missing === null ? null : `Needs ${missing}`
  return (
    <li data-testid="song-row" data-song={song.id} className="flex items-center">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-baseline gap-3 py-3 pr-1 pl-4 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset active:bg-muted"
        aria-label={song.title}
        aria-describedby={valueId}
        onClick={onOpen}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1.5" aria-hidden>
          <span>{song.title}</span>
          <Progress value={coverageFraction(coverage) * 100} />
          <span className="flex flex-col gap-0.5 text-sm text-muted-foreground">
            <span>{coverageSummary(coverage)}</span>
            {needs && <span>{needs}</span>}
          </span>
        </span>
        <Lock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span id={valueId} className="sr-only">
          {['Locked', coverageSummary(coverage), needs].filter(Boolean).join('. ')}
        </span>
      </button>
      <FavoriteButton song={song} className="mr-1" />
    </li>
  )
}
