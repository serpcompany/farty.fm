'use client'

import { Heart } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import type { Song } from '@/lib/catalog/song'
import { loadFavorites, onFavoritesChanged, setFavorite } from '@/lib/favorite-store'
import { onLibraryChanged } from '@/lib/library-changes'
import { reportError } from '@/lib/telemetry/errors'
import { cn } from '@/lib/utils'
import { openVisit } from '@/lib/visit'

type Favorites = ReadonlySet<string> | null

let favorites: Favorites = null
const listeners = new Set<() => void>()
let started = false
let generation = 0

function publish(next: ReadonlySet<string>) {
  favorites = next
  for (const listener of listeners) listener()
}

async function read() {
  const mine = ++generation
  try {
    await openVisit().library.catch(() => undefined)
    const ids = await loadFavorites()
    if (mine === generation) publish(new Set(ids))
  } catch (error) {
    reportError('favorite-failed', error)
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

export function useFavorites(): Favorites {
  return useSyncExternalStore(
    subscribe,
    () => favorites,
    () => null
  )
}

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
