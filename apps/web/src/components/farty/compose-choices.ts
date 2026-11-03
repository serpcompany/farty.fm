'use client'

import { useEffect, useState } from 'react'
import type { SongOrder } from '@/lib/pitch-coverage'

export const songOrders: { value: SongOrder; label: string }[] = [
  { value: 'closestToUnlocking', label: 'Closest to unlocking' },
  { value: 'alphabetical', label: 'A–Z' },
  { value: 'favoritesFirst', label: 'Favorites first' }
]

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
    return
  }
}

type ComposeChoices = {
  order: SongOrder
  chooseOrder: (order: SongOrder) => void
  onlyFavorites: boolean
  chooseOnlyFavorites: (only: boolean) => void
}

export function useComposeChoices(): ComposeChoices {
  const [order, setOrder] = useState<SongOrder>('closestToUnlocking')
  const [onlyFavorites, setOnlyFavorites] = useState(false)

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
