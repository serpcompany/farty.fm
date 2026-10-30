import { maximumTakeSeconds } from './recordings'

// A Performance (#278): what the user played on the Sound Pad while it recorded, kept by a Toot
// made from it (ADR 0016). It plays only the Recordings it names, each tap raw from its start.

/** The longest Performance, from its first tap: as long as a take (`maximumTakeSeconds`). */
export const MAX_PERFORMANCE_SECONDS = maximumTakeSeconds

/** The most taps one Performance keeps: more than 30 taps a second for 30 s. */
export const MAX_TAPS = 1000

/** The most Recordings one Performance plays: a later release may have more Pads. */
const MAX_PERFORMANCE_RECORDINGS = 100

/**
 * Which Recording each tap played, and when. Kept small, since it uploads with its Toot: each
 * Recording's id once, and each tap as `[seconds from the first tap, index in recordings]`, in
 * the order played.
 */
export type Performance = {
  recordings: string[]
  taps: [at: number, recording: number][]
}

/** One tap as the Sound Pad records it: `at` in seconds, on any clock. */
export type Tap = { at: number; recordingId: string }

/**
 * The Performance of `taps`, timed from the first tap and to the millisecond, so it plays from
 * its first fart. Null for no taps. Taps past `MAX_PERFORMANCE_SECONDS` or `MAX_TAPS` are left
 * out.
 */
export function performanceOf(taps: readonly Tap[]): Performance | null {
  const sorted = [...taps].sort((a, b) => a.at - b.at)
  if (sorted.length === 0) return null
  const first = sorted[0].at
  const recordings: string[] = []
  const kept: [number, number][] = []
  for (const tap of sorted) {
    const at = Math.round((tap.at - first) * 1000) / 1000
    if (at > MAX_PERFORMANCE_SECONDS || kept.length === MAX_TAPS) break
    let index = recordings.indexOf(tap.recordingId)
    if (index === -1) index = recordings.push(tap.recordingId) - 1
    kept.push([at, index])
  }
  return { recordings, taps: kept }
}

/** Each tap of `performance`, with its Recording's id. */
export function tapsOf(performance: Performance): Tap[] {
  return performance.taps.map(([at, index]) => ({ at, recordingId: performance.recordings[index] }))
}

const ITEM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * Whether `value` is a Performance this app can play: one to `MAX_TAPS` taps in time order, from
 * 0 to `MAX_PERFORMANCE_SECONDS`, each of a Recording it names by a Recording's id, and every
 * Recording it names played. What the account keeps, and what a take kept across Checkout is.
 */
export function isPerformance(value: unknown): value is Performance {
  if (typeof value !== 'object' || value === null) return false
  const { recordings, taps } = value as Record<string, unknown>
  if (!Array.isArray(recordings) || !Array.isArray(taps)) return false
  if (recordings.length === 0 || recordings.length > MAX_PERFORMANCE_RECORDINGS) return false
  if (!recordings.every(id => typeof id === 'string' && ITEM_ID.test(id))) return false
  if (new Set(recordings).size !== recordings.length) return false
  if (taps.length === 0 || taps.length > MAX_TAPS) return false
  const played = new Set<number>()
  let last = 0
  for (const tap of taps) {
    if (!Array.isArray(tap) || tap.length !== 2) return false
    const [at, index] = tap
    if (typeof at !== 'number' || !Number.isFinite(at)) return false
    if (at < last || at > MAX_PERFORMANCE_SECONDS) return false
    if (!Number.isInteger(index) || index < 0 || index >= recordings.length) return false
    last = at
    played.add(index)
  }
  return played.size === recordings.length
}
