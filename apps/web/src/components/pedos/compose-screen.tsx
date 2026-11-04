'use client'

import {
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Heart,
  LayoutGrid,
  Music2,
  Search,
  X
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react'
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
import { type KindChoice, kindChoices, type SongSummary } from '@/lib/catalog/song'
import { songListing, sortRows } from '@/lib/pitch-coverage'
import { cn } from '@/lib/utils'
import { songOrders, useComposeChoices } from './compose-choices'
import { useFavorites } from './favorite-button'
import { LockedSongSheet } from './locked-song-sheet'
import { usePedos } from './pedos-provider'
import { ReportSongSheet } from './report-song-sheet'
import { LockedSongRow, songList, UnlockedSongRow } from './song-row'

const noFavorites: ReadonlySet<string> = new Set()

/**
 * Compose: the Song Catalog with each Song's Pitch Coverage. Search it by title, composer, kind or
 * origin, sort it, show only the Ready or Favorite Songs (#356), and show one kind of Song, or the
 * Well known ones, with a Kind chip (#384). Open an Unlocked Song in Song Creator, or a locked Song
 * to see which notes it still needs. It began as a port of the iPhone app's
 * `ComposeTab`, which still lists Favorites first and has no composer, Ready filter, Most popular or
 * Fewest notes: the web screen is the newer one, so port from here to the iPhone, not back.
 */
export function ComposeScreen() {
  const pedos = usePedos()
  const router = useRouter()
  const [query, setQuery] = useState('')
  const searchBox = useRef<HTMLInputElement>(null)
  const {
    order,
    chooseOrder,
    onlyFavorites,
    chooseOnlyFavorites,
    onlyReady,
    chooseOnlyReady,
    kind,
    chooseKind
  } = useComposeChoices()
  const kindRow = useRef<HTMLDivElement>(null)
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

  // The chosen Kind chip scrolls into sight, as when a remembered one is past the screen's edge.
  useEffect(() => {
    if (kind === null) return
    kindRow.current
      ?.querySelector('[aria-pressed="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [kind])

  const sorted = useMemo(() => sortRows(pedos.songRows, order), [pedos.songRows, order])
  // A heart tap filters again only while the Favorites filter is on.
  const only = onlyFavorites ? (favorites ?? noFavorites) : null
  const listing = useMemo(
    () => songListing(sorted, query, { ready: onlyReady, favorites: only, kind }),
    [sorted, query, onlyReady, only, kind]
  )
  const listed = listing.unlocked.length + listing.locked.length
  // The whole catalog, or the search within it: the Sound Pad and the first steps show with it.
  const showsAll = query === '' && !onlyFavorites && !onlyReady && kind === null
  const orderLabel = (songOrders.find(o => o.value === order) ?? songOrders[0]).label
  const showAll = () => {
    chooseOnlyReady(false)
    chooseOnlyFavorites(false)
    chooseKind(null)
  }

  return (
    <div className="flex flex-1 flex-col px-4 pb-6">
      <h1 className="pt-4 pb-1 text-3xl font-bold tracking-tight">Compose</h1>

      {/* Search and the chips stay in reach while the list scrolls. */}
      <div className="sticky top-[env(safe-area-inset-top)] z-10 -mx-4 flex flex-col gap-1 bg-background/95 px-4 pt-1.5 pb-1 backdrop-blur md:top-[calc(4rem+1px)]">
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
        {/* One kind at a time, or none: tapping the chosen chip again shows every Song (#384). The
            fieldset only names the chips; the row inside scrolls sideways, to the screen's edges. */}
        <fieldset className="-mx-4 min-w-0" data-testid="kind-chips">
          <legend className="sr-only">Kinds</legend>
          <div
            ref={kindRow}
            className="flex scroll-px-4 gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {kindChoices.map(choice => (
              <button
                key={choice}
                type="button"
                className={chip}
                aria-pressed={kind === choice}
                onClick={() => chooseKind(kind === choice ? null : choice)}
              >
                <span className={chipFace}>{choice}</span>
              </button>
            ))}
          </div>
        </fieldset>
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
          {kind !== null && listed > 0 && (
            <p className="-mb-3 px-4 text-sm text-muted-foreground" data-testid="kind-count">
              {kind} · {listed}
            </p>
          )}
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
          {listed === 0 && (
            <NoSongs
              query={query.trim()}
              onlyReady={onlyReady}
              onlyFavorites={onlyFavorites}
              kind={kind}
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
 * there are any. Every kind has Songs, so a Kind chip empties the list only with another filter or
 * a search (#384).
 */
function NoSongs({
  query,
  onlyReady,
  onlyFavorites,
  kind,
  hasFavorites,
  onShowAll
}: {
  query: string
  onlyReady: boolean
  onlyFavorites: boolean
  kind: KindChoice | null
  hasFavorites: boolean
  onShowAll: () => void
}) {
  const filters = [onlyReady && 'Ready', onlyFavorites && 'Favorite'].filter(Boolean)
  const inKind = kind === null ? '' : ` in ${kind}`
  const [icon, title, description, action]: [ReactNode, string, string, string?] =
    query !== ''
      ? filters.length === 0 && kind === null
        ? [
            <Search key="icon" />,
            `No Results for “${query}”`,
            'Check the spelling or try a new search.'
          ]
        : [
            <Search key="icon" />,
            `No ${[...filters, 'Songs'].join(' ')}${inKind} match “${query}”`,
            'The filters are on. Search every Song instead.',
            'Search all Songs'
          ]
      : onlyFavorites && (!hasFavorites || (!onlyReady && kind === null))
        ? [
            <Heart key="icon" />,
            'No Favorites yet',
            'Tap the heart on a Song to add it to your Favorites.',
            onlyReady || kind !== null ? 'Show all Songs' : undefined
          ]
        : onlyFavorites && onlyReady
          ? [
              <CircleCheck key="icon" />,
              `No Ready Favorites${inKind}`,
              `None of your Favorites${inKind} is unlocked yet.`,
              'Show all Songs'
            ]
          : onlyFavorites
            ? [
                <Heart key="icon" />,
                `No Favorites${inKind}`,
                'Tap the heart on a Song to add it to your Favorites.',
                'Show all Songs'
              ]
            : onlyReady
              ? [
                  <CircleCheck key="icon" />,
                  `No Ready Songs${inKind} yet`,
                  'Record a few farts with a clear note to unlock a Song.',
                  'Show all Songs'
                ]
              : [
                  <Music2 key="icon" />,
                  `No Songs${inKind}`,
                  'Try another kind, or show every Song.',
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
      <ul className={songList}>{children}</ul>
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
