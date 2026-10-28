'use client'

import { ArrowUpDown, ChevronRight, Lock, Music2, Search } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type ReactNode, useId, useState } from 'react'
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
  type SongOrder,
  type SongRow,
  songListing,
  sortRows
} from '@/lib/pitch-coverage'
import { LockedSongSheet } from './locked-song-sheet'
import { usePageHidden } from './page-hidden'
import { useRecordings } from './recordings-provider'

const orders: { value: SongOrder; label: string }[] = [
  { value: 'closestToUnlocking', label: 'Closest to unlocking' },
  { value: 'alphabetical', label: 'A–Z' }
]

export function ComposeScreen() {
  const { songRows, recordings, melodicRecordings } = useRecordings()
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [order, setOrder] = useState<SongOrder>('closestToUnlocking')
  const [lockedSong, setLockedSong] = useState<Song | null>(null)
  usePageHidden(() => setLockedSong(null))

  const listing = songListing(sortRows(songRows, order), query)
  const isEmpty = listing.unlocked.length === 0 && listing.locked.length === 0

  return (
    <div className="flex flex-1 flex-col px-4 pb-6">
      <div className="flex items-center justify-between gap-2 pt-4 pb-3">
        <h1 className="text-3xl font-bold tracking-tight">Compose</h1>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon" className="size-11" aria-label="Sort" />}
            data-testid="sort-songs"
          >
            <ArrowUpDown />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto">
            <DropdownMenuRadioGroup value={order} onValueChange={value => setOrder(value)}>
              {orders.map(({ value, label }) => (
                <DropdownMenuRadioItem key={value} value={value} className="py-2 text-base">
                  {label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
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

      {recordings === null ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {melodicRecordings.length === 0 && query === '' && (
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
          {isEmpty && (
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

function UnlockedSongRow({ song }: { song: Song }) {
  return (
    <li data-testid="song-row" data-song={song.id}>
      <Link
        href={`/compose/${song.id}/`}
        onClick={startAudioInTap}
        className="flex min-h-11 items-center justify-between gap-3 px-4 py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset active:bg-muted"
      >
        <span>{song.title}</span>
        <span className="flex items-center gap-1 text-muted-foreground">
          Ready
          <ChevronRight className="size-4" aria-hidden />
        </span>
      </Link>
    </li>
  )
}

function LockedSongRow({ row, onOpen }: { row: SongRow; onOpen: () => void }) {
  const { song, coverage } = row
  const valueId = useId()
  const missing = missingNotes(coverage, 2)
  const needs = missing === null ? null : `Needs ${missing}`
  return (
    <li data-testid="song-row" data-song={song.id}>
      <button
        type="button"
        className="flex w-full items-baseline gap-3 px-4 py-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset active:bg-muted"
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
    </li>
  )
}
