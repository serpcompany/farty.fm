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
import { type ReactNode, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
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
import { type SongOrder, songListing, sortRows } from '@/lib/pitch-coverage'
import { cn } from '@/lib/utils'
import { showChoices, songOrders, useComposeChoices } from './compose-choices'
import { useFavorites } from './favorite-button'
import { LockedSongSheet } from './locked-song-sheet'
import { usePedos } from './pedos-provider'
import { ReportSongSheet } from './report-song-sheet'
import { LockedSongRow, songList, UnlockedSongRow } from './song-row'
import { useFartChoices } from './use-fart-choices'

const noFavorites: ReadonlySet<string> = new Set()

/**
 * Compose: the Song Catalog with each Song's Pitch Coverage. Search it by title, composer, kind or
 * origin, narrow it with the Kind and Show dropdowns, and sort it, all in one row under the search
 * box (#397). Open an Unlocked Song in Song Creator, or a locked Song to see which notes it still
 * needs. It began as a port of the iPhone app's `ComposeTab`, which still lists Favorites first and
 * has no composer, Ready filter, Most popular or Fewest notes: the web screen is the newer one, so
 * port from here to the iPhone, not back.
 */
export function ComposeScreen() {
  const pedos = usePedos()
  const router = useRouter()
  const [query, setQuery] = useState('')
  const searchBox = useRef<HTMLInputElement>(null)
  const { order, chooseOrder, kinds, chooseKinds, show, chooseShow } = useComposeChoices()
  const [lockedSong, setLockedSong] = useState<SongSummary | null>(null)
  /** The Song a locked sheet's Report a problem opened the report sheet for (#358). */
  const [reportedSong, setReportedSong] = useState<SongSummary | null>(null)
  const favorites = useFavorites()
  // `pedos.songRows` counts a Song's Fart Choices, so no Song shows unlocked until they're read.
  const fartChoices = useFartChoices()

  // The page comes back on the Record tab, so the sheet doesn't stay open.
  useEffect(() => {
    const visibilityChanged = () => {
      if (document.visibilityState === 'hidden') setLockedSong(null)
    }
    document.addEventListener('visibilitychange', visibilityChanged)
    return () => document.removeEventListener('visibilitychange', visibilityChanged)
  }, [])

  const sorted = useMemo(() => sortRows(pedos.songRows, order), [pedos.songRows, order])
  const onlyReady = show.includes('Ready')
  const onlyFavorites = show.includes('Favorites')
  // A heart tap filters again only while the Favorites filter is on.
  const only = onlyFavorites ? (favorites ?? noFavorites) : null
  const listing = useMemo(
    () => songListing(sorted, query, { ready: onlyReady, favorites: only, kinds }),
    [sorted, query, onlyReady, only, kinds]
  )
  const listed = listing.unlocked.length + listing.locked.length
  // The whole catalog, or the search within it: the Sound Pad and the first steps show with it.
  const showsAll = query === '' && show.length === 0 && kinds.length === 0
  const showAll = () => {
    chooseShow([])
    chooseKinds([])
  }

  return (
    <div className="flex flex-1 flex-col px-4 pb-6">
      <h1 className="pt-4 pb-1 text-3xl font-bold tracking-tight">Compose</h1>

      {/* Search and the dropdowns stay in reach while the list scrolls. */}
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
        {/* One row, unless the device's font is too wide for it: then Sort takes a line of its own
            rather than a filter's name being cut. */}
        <div
          className="flex min-h-11 flex-wrap items-center gap-x-1.5 gap-y-2.5"
          data-testid="song-filters"
        >
          <FilterMenu
            name="Kind"
            all="All kinds"
            choices={kindChoices}
            chosen={kinds}
            onChoose={chooseKinds}
          />
          <FilterMenu
            name="Show"
            all="All Songs"
            choices={showChoices}
            chosen={show}
            onChoose={chooseShow}
          />
          <SortMenu order={order} onChoose={chooseOrder} />
        </div>
      </div>

      {pedos.songsFailed ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-muted-foreground">Couldn't load the Songs.</p>
          <Button variant="outline" className="h-11 px-5 text-base" onClick={pedos.reloadSongs}>
            Try again
          </Button>
        </div>
      ) : pedos.recordings === null ||
        pedos.songs === null ||
        favorites === null ||
        fartChoices === null ? (
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
          {listed === 0 && (
            <NoSongs
              query={query.trim()}
              onlyReady={onlyReady}
              onlyFavorites={onlyFavorites}
              kinds={kinds}
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

// One control of the row: a 34 px pill around buttons a thumb can hit, 44 px high and at least as
// wide, which reach into the gaps and the page's margin without covering each other. It greys while
// its menu is open, unless a filter fills it.
const pill =
  'flex h-[34px] min-w-0 items-center rounded-full border text-sm whitespace-nowrap transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/50'
const pillUnfilled = 'border-border hover:bg-muted has-aria-expanded:bg-muted'
const pillButton = 'flex h-11 min-w-0 items-center gap-1.5 outline-none'
const menuItem = 'min-h-11 text-base'

/** Back to the first Song, which a choice in a list scrolled far down would otherwise hide. */
const toTop = () => window.scrollTo(0, 0)

/**
 * One filter's dropdown (#397), Kind or Show: a checkbox menu that stays open while you pick, whose
 * top row turns them all off. With a filter on, it fills and names the choice, or counts several,
 * and its × clears it. A remembered filter shows the same way.
 */
function FilterMenu<Choice extends string>({
  name,
  all,
  choices,
  chosen,
  onChoose
}: {
  name: string
  /** The menu's top row, on while nothing is chosen. */
  all: string
  choices: readonly Choice[]
  chosen: readonly Choice[]
  onChoose: (chosen: readonly Choice[]) => void
}) {
  const trigger = useRef<HTMLButtonElement>(null)
  const on = chosen.length > 0
  const choose = (next: readonly Choice[]) => {
    onChoose(next)
    toTop()
  }
  return (
    <DropdownMenu>
      <div
        className={cn(
          pill,
          on ? 'border-primary bg-primary text-primary-foreground' : pillUnfilled
        )}
      >
        <DropdownMenuTrigger
          ref={trigger}
          className={cn(pillButton, on ? 'pr-1.5 pl-2.5' : 'px-3')}
          aria-label={on ? `${name}: ${chosen.join(', ')}` : name}
        >
          <span className="truncate">
            {chosen.length > 1 ? `${name} · ${chosen.length}` : (chosen[0] ?? name)}
          </span>
          {!on && <ChevronDown className="size-4 shrink-0" aria-hidden />}
        </DropdownMenuTrigger>
        {on && (
          // 44 px wide, to the next pill on its right. To keep the row narrow it also covers the
          // label's padding and the label's last 5 px, which a thumb needs more than the label does.
          <button
            type="button"
            className="relative -mr-[7px] -ml-[11px] flex size-11 shrink-0 items-center justify-center outline-none"
            aria-label={`Clear ${name}`}
            onClick={() => {
              choose([])
              trigger.current?.focus()
            }}
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
      <DropdownMenuContent className="w-auto">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{name}</DropdownMenuLabel>
          <DropdownMenuCheckboxItem
            className={menuItem}
            checked={!on}
            onCheckedChange={() => {
              if (on) choose([])
            }}
          >
            {all}
          </DropdownMenuCheckboxItem>
          {choices.map(choice => (
            <DropdownMenuCheckboxItem
              key={choice}
              className={menuItem}
              checked={chosen.includes(choice)}
              onCheckedChange={checked =>
                choose(choices.filter(c => (c === choice ? checked : chosen.includes(c))))
              }
            >
              {choice}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The sort, at the right of the row: "Sort", or the order chosen if it isn't the first. It never
 * fills, because it hides nothing. Where the filters leave too little room for its whole face, it
 * shows only its icon, so a word is never cut short. Widths follow the device's system font, so the
 * room is measured, against the whole face drawn unseen.
 */
function SortMenu({ order, onChoose }: { order: SongOrder; onChoose: (order: SongOrder) => void }) {
  const room = useRef<HTMLDivElement>(null)
  const whole = useRef<HTMLSpanElement>(null)
  const [fits, setFits] = useState(true)
  useLayoutEffect(() => {
    const [left, needed] = [room.current, whole.current]
    if (!left || !needed) return
    const measure = () => setFits(needed.offsetWidth <= left.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(left)
    observer.observe(needed)
    return () => observer.disconnect()
  }, [])
  const { label } = songOrders.find(o => o.value === order) ?? songOrders[0]
  const face = (
    <>
      <ArrowUpDown className="size-4 shrink-0" aria-hidden />
      <span>{order === songOrders[0].value ? 'Sort' : label}</span>
      <ChevronDown className="size-4 shrink-0" aria-hidden />
    </>
  )
  return (
    <div ref={room} className="relative flex min-w-[34px] flex-1 justify-end">
      <span ref={whole} className={cn(pill, 'invisible absolute right-0 gap-1.5 px-3')} aria-hidden>
        {face}
      </span>
      <DropdownMenu>
        <div className={cn(pill, pillUnfilled, !fits && 'w-[34px]')}>
          <DropdownMenuTrigger
            // Without its words, its 44 px reach right, into the page's margin, clear of Show's ×.
            className={cn(
              pillButton,
              fits ? 'px-3' : '-mr-[11px] -ml-px w-11 shrink-0 justify-center pr-2.5'
            )}
            aria-label={`Sort: ${label}`}
            data-testid="sort-songs"
          >
            {fits ? face : <ArrowUpDown className="size-4" aria-hidden />}
          </DropdownMenuTrigger>
        </div>
        <DropdownMenuContent align="end" className="w-auto">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Sort by</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={order}
              onValueChange={next => {
                if (next === order) return
                onChoose(next)
                toTop()
              }}
            >
              {songOrders.map(({ value, label }) => (
                <DropdownMenuRadioItem key={value} value={value} closeOnClick className={menuItem}>
                  {label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/**
 * What Compose says when it lists no Song: why, and a way to show the Songs a filter hides, when
 * there are any. Every kind has Songs, so the Kind filter empties the list only with another filter
 * or a search (#384).
 */
function NoSongs({
  query,
  onlyReady,
  onlyFavorites,
  kinds,
  hasFavorites,
  onShowAll
}: {
  query: string
  onlyReady: boolean
  onlyFavorites: boolean
  kinds: readonly KindChoice[]
  hasFavorites: boolean
  onShowAll: () => void
}) {
  const filters = [onlyReady && 'Ready', onlyFavorites && 'Favorite'].filter(Boolean)
  const anyKind = kinds.length > 0
  const inKind = anyKind ? ` in ${kinds.join(', ')}` : ''
  const [icon, title, description, action]: [ReactNode, string, string, string?] =
    query !== ''
      ? filters.length === 0 && !anyKind
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
      : onlyFavorites && (!hasFavorites || (!onlyReady && !anyKind))
        ? [
            <Heart key="icon" />,
            'No Favorites yet',
            'Tap the heart on a Song to add it to your Favorites.',
            onlyReady || anyKind ? 'Show all Songs' : undefined
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
