'use client'

import { useLayoutEffect, useState } from 'react'
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

/** Compose's Show menu, in its order (#397). */
export const showChoices = ['Ready', 'Favorites'] as const
export type ShowChoice = (typeof showChoices)[number]

// The order and the filters this browser chose last (#313, #356, #384). The Kinds are kept
// comma-joined, so the one Kind a browser kept before several could be chosen (#397) reads as is.
const orderKey = 'pedos.composeOrder'
const showKeys: Record<ShowChoice, string> = {
  Ready: 'pedos.composeReady',
  Favorites: 'pedos.composeFavorites'
}
const kindsKey = 'pedos.composeKind'

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
  /** The Kinds chosen, in the menu's order: a Song in any of them shows. None shows every Song. */
  kinds: readonly KindChoice[]
  chooseKinds: (kinds: readonly KindChoice[]) => void
  /** Ready, Favorites or both, in the menu's order: a Song must be all of them. */
  show: readonly ShowChoice[]
  chooseShow: (show: readonly ShowChoice[]) => void
}

/** Compose's sort and its Kind and Show filters, as this browser chose them last. */
export function useComposeChoices(): ComposeChoices {
  const [order, setOrder] = useState<SongOrder>('closestToUnlocking')
  const [kinds, setKinds] = useState<readonly KindChoice[]>([])
  const [show, setShow] = useState<readonly ShowChoice[]>([])

  // Read after the first render, which the server rendered without them, and before the browser
  // puts the page back where it was: a list that narrowed after that would lose your place.
  useLayoutEffect(() => {
    const kept = readChoice(orderKey)
    const known = songOrders.find(o => o.value === kept)
    if (known) setOrder(known.value)
    setShow(showChoices.filter(choice => readChoice(showKeys[choice]) === 'true'))
    // A kind this browser kept that isn't in the menu now reads as none.
    const keptKinds = readChoice(kindsKey)?.split(',') ?? []
    setKinds(kindChoices.filter(kind => keptKinds.includes(kind)))
  }, [])

  return {
    order,
    chooseOrder: next => {
      setOrder(next)
      keepChoice(orderKey, next)
    },
    kinds,
    chooseKinds: next => {
      setKinds(next)
      keepChoice(kindsKey, next.join(','))
    },
    show,
    chooseShow: next => {
      setShow(next)
      for (const choice of showChoices) keepChoice(showKeys[choice], String(next.includes(choice)))
    }
  }
}
