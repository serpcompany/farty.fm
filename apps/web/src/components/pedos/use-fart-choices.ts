'use client'

import { useSyncExternalStore } from 'react'
import type { FartChoices } from '@/lib/engine/fart-choices'
import { loadFartChoices, onFartChoicesChanged, setFartChoices } from '@/lib/fart-choice-store'
import { onLibraryChanged } from '@/lib/library-sync'
import { reportError } from '@/lib/telemetry/errors'
import { openVisit } from '@/lib/visit'

// The Fart Choices (#360) for Song Creator and Pitch Coverage (#372), as `favorite-button.tsx`
// holds the Favorite Songs: read once the visit has opened the library, again on each change (a
// change here, another tab's, a sync's, a sign-out's), and changed on screen at once.

/** Every changed Song's Fart Choices, by Song id, or null until they're read. */
type AllChoices = ReadonlyMap<string, FartChoices> | null

let all: AllChoices = null
const listeners = new Set<() => void>()
let started = false
/** Bumped by each read and change, so an older read never undoes a newer one. */
let generation = 0

function publish(next: ReadonlyMap<string, FartChoices>) {
  all = next
  for (const listener of listeners) listener()
}

async function read() {
  const mine = ++generation
  try {
    // A guest's new visit may clear the last one's library first (`visit.ts`).
    await openVisit().library.catch(() => {})
    const choices = await loadFartChoices()
    if (mine === generation) publish(choices)
  } catch (error) {
    reportError('fart-choices-failed', error)
    // Every Song automatic, rather than none to play.
    if (mine === generation && all === null) publish(new Map())
  }
}

function subscribe(listener: () => void) {
  if (!started) {
    started = true
    void read()
    onFartChoicesChanged(() => void read())
    onLibraryChanged(change => {
      if (change.reset) void read()
    })
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Every changed Song's Fart Choices, by Song id, or null until they're read. */
export function useFartChoices(): AllChoices {
  return useSyncExternalStore(
    subscribe,
    () => all,
    () => null
  )
}

/** Makes `choices` the Song's Fart Choices, or with null makes it automatic: at once, then kept. */
export async function changeFartChoices(songId: string, choices: FartChoices | null) {
  const next = new Map(all ?? [])
  if (choices) next.set(songId, choices)
  else next.delete(songId)
  generation++
  publish(next)
  try {
    await setFartChoices(songId, choices)
  } catch (error) {
    reportError('fart-choices-failed', error)
    void read()
  }
}
