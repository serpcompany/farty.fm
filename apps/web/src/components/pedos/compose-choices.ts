'use client'

import { useEffect, useState } from 'react'
import { type KindChoice, kindChoices } from '@/lib/catalog/song'
import type { SongOrder } from '@/lib/pitch-coverage'

/**
 * Compose's sort menu, in its order (#356). An order this browser kept that isn't here, such as
 * the old Favorites first, reads as the first.
 */
export const songOrders: { value: SongOrder; label: string }[] = [
  { value: 'closestToUnlocking', label: 'Closest to unlocking' },
  { value: 'mostPopular', label: 'Most popular' },
  { value: 'fewestNotes', label: 'Fewest notes' },
  { value: 'alphabetical', label: 'A–Z' }
]

// The order and the filters this browser chose last (#313, #356, #384).
const orderKey = 'pedos.composeOrder'
const onlyFavoritesKey = 'pedos.composeFavorites'
const onlyReadyKey = 'pedos.composeReady'
const kindKey = 'pedos.composeKind'

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
  onlyReady: boolean
  chooseOnlyReady: (only: boolean) => void
  /** The Kind chip chosen, or null for every Song. */
  kind: KindChoice | null
  chooseKind: (kind: KindChoice | null) => void
}

/** Compose's sort and its Ready, Favorites and Kind filters, as this browser chose them last. */
export function useComposeChoices(): ComposeChoices {
  const [order, setOrder] = useState<SongOrder>('closestToUnlocking')
  const [onlyFavorites, setOnlyFavorites] = useState(false)
  const [onlyReady, setOnlyReady] = useState(false)
  const [kind, setKind] = useState<KindChoice | null>(null)

  // Read after the first render, which the server rendered without them.
  useEffect(() => {
    const kept = readChoice(orderKey)
    const known = songOrders.find(o => o.value === kept)
    if (known) setOrder(known.value)
    setOnlyFavorites(readChoice(onlyFavoritesKey) === 'true')
    setOnlyReady(readChoice(onlyReadyKey) === 'true')
    // A kind this browser kept that isn't a chip now reads as none.
    setKind(kindChoices.find(k => k === readChoice(kindKey)) ?? null)
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
    },
    onlyReady,
    chooseOnlyReady: only => {
      setOnlyReady(only)
      keepChoice(onlyReadyKey, String(only))
    },
    kind,
    chooseKind: next => {
      setKind(next)
      keepChoice(kindKey, next ?? '')
    }
  }
}
