import type { Trim } from '@/lib/recordings'
import { frameRms } from './frame-rms'
import { ANALYSIS_SAMPLE_RATE } from './resample'

interface Gesture {
  start: number
  end: number
  pitchEnd: number
  cutAtReattack: boolean
}

export const LEVEL_HOP_SECONDS = 0.005
export const FINE_FRAME_HOPS = 2
const SMOOTH_FRAME_HOPS = 10
export const ONSET_BELOW_PEAK_DB = 12
export const ONSET_LEAD_SECONDS = 0.008
const FADED_BELOW_PEAK_DB = 30
const REATTACK_DIP_DB = 6
const REATTACK_RISE_DB = 4
const REATTACK_EARLIEST_SECONDS = 0.06

export function noteSegment(y: Float32Array): Gesture {
  const sr = ANALYSIS_SAMPLE_RATE
  const hop = Math.trunc(LEVEL_HOP_SECONDS * sr)
  const fine = levelDb(y, FINE_FRAME_HOPS * hop, hop)
  const db = levelDb(y, SMOOTH_FRAME_HOPS * hop, hop)

  const peak = max(fine)
  const onset = fine.findIndex(v => v >= peak - ONSET_BELOW_PEAK_DB)
  const start = Math.max(0, onset * hop - Math.trunc(ONSET_LEAD_SECONDS * sr))

  const dbMax = max(db)
  const fadedAt = db.findLastIndex(v => v > dbMax - FADED_BELOW_PEAK_DB) + 1
  let runMax = db[onset]
  let dipAt: number | undefined
  let reattackAt: number | undefined
  for (let i = onset + 1; i < fadedAt; i++) {
    if (db[i] > runMax && dipAt === undefined) runMax = db[i]
    if (db[i] < runMax - REATTACK_DIP_DB && (dipAt === undefined || db[i] < db[dipAt])) dipAt = i
    if (
      dipAt !== undefined &&
      db[i] > db[dipAt] + REATTACK_RISE_DB &&
      (i - onset) * hop > REATTACK_EARLIEST_SECONDS * sr
    ) {
      reattackAt = dipAt
      break
    }
  }
  const end = Math.min(y.length, fadedAt * hop + hop)
  const pitchEnd = reattackAt === undefined ? end : Math.min(end, reattackAt * hop + hop)
  return { start, end, pitchEnd, cutAtReattack: reattackAt !== undefined }
}

export function trimBounds(y: Float32Array, startSeconds: number, endSeconds: number): Trim {
  const sr = ANALYSIS_SAMPLE_RATE
  const a = Math.max(0, Math.min(y.length, Math.round(startSeconds * sr)))
  const b = Math.max(a, Math.min(y.length, Math.round(endSeconds * sr)))
  if (b - a < 2) throw new Error('A Trim keeps at least two samples')
  const { start, end } = noteSegment(y.subarray(a, b))
  return { startSeconds: (a + start) / sr, endSeconds: (a + end) / sr }
}

export function levelDb(y: Float32Array, frameLength: number, hop: number): Float64Array {
  return frameRms(y, frameLength, hop).map(rms => 20 * Math.log10(rms + 1e-9))
}

function max(x: Float64Array): number {
  let m = Number.NEGATIVE_INFINITY
  for (const v of x) if (v > m) m = v
  return m
}
