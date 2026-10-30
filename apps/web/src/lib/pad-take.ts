import { isPerformance, type Performance } from './performance'

// The Sound Pad's takes (#278), kept in this browser while they're unsaved, by Toot id: Checkout
// leaves the page, and back from it, or on the next open of the Sound Pad if the return never
// loaded, the Pad makes the same Toot again from its take, with the id it was paid for (ADR 0010,
// ADR 0017), as Song Creator makes a Song's again. Only Recording ids and times, never audio.
// Storage that can't be read keeps nothing: the take then lasts the page, and isn't paid for.

const KEY = 'pedos.padTakes'

/** At most this many takes are kept: a new one past it lets the oldest go. */
export const MAX_KEPT_TAKES = 5

/** A take kept across Checkout: the Toot's id and its Performance. */
export type KeptTake = { tootId: string; performance: Performance }

function isKeptTake(value: unknown): value is KeptTake {
  if (typeof value !== 'object' || value === null) return false
  const { tootId, performance } = value as Record<string, unknown>
  return typeof tootId === 'string' && isPerformance(performance)
}

/** The kept takes, oldest first, as stored. Throws when storage can't be read. */
function stored(): KeptTake[] {
  const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
  return Array.isArray(value) ? value.filter(isKeptTake) : []
}

/**
 * Keeps the take made into the Toot `tootId`, as the newest. False when it can't be kept, such
 * as with storage blocked or full: back from Checkout, it couldn't be made again.
 */
export function keepTake(tootId: string, performance: Performance): boolean {
  try {
    const takes = stored().filter(take => take.tootId !== tootId)
    takes.push({ tootId, performance })
    localStorage.setItem(KEY, JSON.stringify(takes.slice(-MAX_KEPT_TAKES)))
    return true
  } catch {
    return false
  }
}

/** The kept takes, newest first, or none when storage can't be read. */
export function keptTakes(): KeptTake[] {
  try {
    return stored().reverse()
  } catch {
    return []
  }
}

/** The kept take of the Toot `tootId`, or null. */
export function keptTake(tootId: string): KeptTake | null {
  return keptTakes().find(take => take.tootId === tootId) ?? null
}

/** Lets go of the Toot `tootId`'s kept take: it's saved, its payment is used, or it's gone. */
export function forgetTake(tootId: string): void {
  try {
    const takes = stored()
    const left = takes.filter(take => take.tootId !== tootId)
    if (left.length === takes.length) return
    if (left.length === 0) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, JSON.stringify(left))
  } catch {
    // Nothing kept to forget.
  }
}
