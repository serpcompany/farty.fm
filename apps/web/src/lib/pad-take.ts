import { isPerformance, type Performance } from './performance'

// The Sound Pad's last take (#278), kept in this browser while it's unsaved: Checkout leaves the
// page, and back from it the Pad makes the same Toot again from it, with the id it was paid for
// (ADR 0010, ADR 0016), as Song Creator makes a Song's again. Only Recording ids and times, never
// audio. Storage that can't be read keeps nothing: the take then lasts the page.

const KEY = 'pedos.padTake'

/** A take kept across Checkout: the Toot's id and its Performance. */
export type KeptTake = { tootId: string; performance: Performance }

/** Keeps the take made into the Toot `tootId`, in place of any other. */
export function keepTake(tootId: string, performance: Performance): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ tootId, performance }))
  } catch {
    // Not kept: back from Checkout, this take can't be made again.
  }
}

/** The kept take, or null when there's none or it isn't one. */
export function keptTake(): KeptTake | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (typeof value !== 'object' || value === null) return null
    const { tootId, performance } = value as Record<string, unknown>
    return typeof tootId === 'string' && isPerformance(performance) ? { tootId, performance } : null
  } catch {
    return null
  }
}

/** Lets go of the kept take if it's the Toot `tootId`'s: that Toot is saved. */
export function forgetTake(tootId: string): void {
  try {
    if (keptTake()?.tootId === tootId) localStorage.removeItem(KEY)
  } catch {
    // Nothing kept to forget.
  }
}
