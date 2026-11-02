'use client'

import { useEffect, useState } from 'react'
import type { SongOrder } from '@/lib/pitch-coverage'

/** Compose's sort menu, in its order. */
export const songOrders: { value: SongOrder; label: string }[] = [
  { value: 'closestToUnlocking', label: 'Closest to unlocking' },
  { value: 'alphabetical', label: 'A–Z' },
  { value: 'favoritesFirst', label: 'Favorites first' }
]

// The order and the Favorites filter this browser chose last (#313).
const orderKey = 'pedos.composeOrder'
const onlyFavoritesKey = 'pedos.composeFavorites'

function readChoice(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function keepChoice(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // The choice lasts this page, then.
  }
}

export type ComposeChoices = {
  order: SongOrder
  chooseOrder: (order: SongOrder) => void
  onlyFavorites: boolean
  chooseOnlyFavorites: (only: boolean) => void
}

/** Compose's sort and Favorites filter, as this browser chose them last (#313). */
export function useComposeChoices(): ComposeChoices {
  const [order, setOrder] = useState<SongOrder>('closestToUnlocking')
  const [onlyFavorites, setOnlyFavorites] = useState(false)

  // Read after the first render, which the server rendered without them.
  useEffect(() => {
    const kept = readChoice(orderKey)
    const known = songOrders.find(o => o.value === kept)
    if (known) setOrder(known.value)
    setOnlyFavorites(readChoice(onlyFavoritesKey) === 'true')
  }, [])

  return {
    order,
    chooseOrder: next => {
      setOrder(next)
      keepChoice(orderKey, next)
    },
    onlyFavorites,
    chooseOnlyFavorites: only => {
      setOnlyFavorites(only)
      keepChoice(onlyFavoritesKey, String(only))
    }
  }
}
