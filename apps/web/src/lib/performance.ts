import { maximumTakeSeconds } from './recordings'

export const MAX_PERFORMANCE_SECONDS = maximumTakeSeconds

export const MAX_TAPS = 1000

const MAX_PERFORMANCE_RECORDINGS = 100

export type Performance = {
  recordings: string[]
  taps: [at: number, recording: number][]
}

export type Tap = { at: number; recordingId: string }

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

export function tapsOf(performance: Performance): Tap[] {
  return performance.taps.map(([at, index]) => ({ at, recordingId: performance.recordings[index] }))
}

const ITEM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

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
