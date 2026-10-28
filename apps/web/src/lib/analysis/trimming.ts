import { frameRms } from './frame-rms'
import { ANALYSIS_SAMPLE_RATE } from './resample'

interface Gesture {
  start: number
  endExclusive: number
  cutAtReattack: boolean
}

const LEVEL_HOP_SECONDS = 0.005
const FINE_FRAME_HOPS = 2
const SMOOTH_FRAME_HOPS = 10
const ONSET_BELOW_PEAK_DB = 12
const ONSET_LEAD_SECONDS = 0.008
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
  const end = (reattackAt ?? fadedAt) * hop + hop
  return {
    start,
    endExclusive: Math.min(y.length, end),
    cutAtReattack: reattackAt !== undefined
  }
}

function levelDb(y: Float32Array, frameLength: number, hop: number): Float64Array {
  return frameRms(y, frameLength, hop).map(rms => 20 * Math.log10(rms + 1e-9))
}

function max(x: Float64Array): number {
  let m = Number.NEGATIVE_INFINITY
  for (const v of x) if (v > m) m = v
  return m
}
