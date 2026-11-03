'use client'

import { Heart } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import type { Song } from '@/lib/catalog/song'
import { loadFavorites, onFavoritesChanged, setFavorite } from '@/lib/favorite-store'
import { onLibraryChanged } from '@/lib/library-sync'
import { reportError } from '@/lib/telemetry/errors'
import { cn } from '@/lib/utils'
import { openVisit } from '@/lib/visit'

// The Favorite Songs (#313) for the screens: read once the visit has opened the library, again on
// each change (a tap, another tab's, a sync's, a sign-out's), and changed at once on a tap.

/** The Favorite Songs, by Song id, or null until they're read. */
type Favorites = ReadonlySet<string> | null

let favorites: Favorites = null
const listeners = new Set<() => void>()
let started = false
/** Bumped by each read and tap, so an older read never undoes a newer one. */
let generation = 0

function publish(next: ReadonlySet<string>) {
  favorites = next
  for (const listener of listeners) listener()
}

async function read() {
  const mine = ++generation
  try {
    // A guest's new visit may clear the last one's library first (`visit.ts`).
    await openVisit().library.catch(() => {})
    const ids = await loadFavorites()
    if (mine === generation) publish(new Set(ids))
  } catch (error) {
    reportError('favorite-failed', error)
    // No hearts on, rather than none to tap.
    if (mine === generation && favorites === null) publish(new Set())
  }
}

function subscribe(listener: () => void) {
  if (!started) {
    started = true
    void read()
    onFavoritesChanged(() => void read())
    onLibraryChanged(change => {
      if (change.reset) void read()
    })
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The Favorite Songs, by Song id, or null until they're read. */
export function useFavorites(): Favorites {
  return useSyncExternalStore(
    subscribe,
    () => favorites,
    () => null
  )
}

/** Marks the Song a Favorite Song, or takes it off: on screen at once, then kept. */
async function toggleFavorite(songId: string, on: boolean) {
  const next = new Set(favorites ?? [])
  if (on) next.add(songId)
  else next.delete(songId)
  generation++
  publish(next)
  try {
    await setFavorite(songId, on)
  } catch (error) {
    reportError('favorite-failed', error)
    void read()
  }
}

/** A Song's heart: one tap makes it a Favorite Song, another takes it off. */
export function FavoriteButton({
  song,
  className
}: {
  song: Pick<Song, 'id' | 'title'>
  className?: string
}) {
  const current = useFavorites()
  const on = current?.has(song.id) ?? false
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn('size-11', className)}
      aria-label={`Favorite ${song.title}`}
      aria-pressed={on}
      disabled={current === null}
      data-testid="favorite-song"
      onClick={() => void toggleFavorite(song.id, !on)}
    >
      <Heart
        className={cn('size-5', on ? 'fill-current text-primary' : 'text-muted-foreground')}
        aria-hidden
      />
    </Button>
  )
}
