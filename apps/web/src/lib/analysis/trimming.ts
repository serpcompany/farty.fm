import { ANALYSIS_SAMPLE_RATE } from './resample'

/** The single clean gesture of a Recording, in samples of the 44.1 kHz audio. */
export interface Gesture {
  start: number
  /** Exclusive. */
  end: number
  /** The gesture ends at a second attack rather than where the sound fades out. */
  cutAtReattack: boolean
}

/**
 * Automatic trimming: `note_segment()` of the reference engine (`Trimming.noteSegment` in Swift).
 * Finds the single-attack part of a Recording that can act as one note.
 *
 * - Start: on a 5 ms RMS envelope, the first frame within 12 dB of the peak, minus 8 ms, so slow
 *   swells don't make the note sound late.
 * - End: on a 50 ms RMS envelope (fast flutter is smoothed away), the first slow re-attack: a dip
 *   of more than 6 dB below the running maximum, then a rise of more than 4 dB, more than 60 ms
 *   after the start. Otherwise where the level falls 30 dB below its peak.
 */
export function noteSegment(y: Float32Array): Gesture {
  const sr = ANALYSIS_SAMPLE_RATE
  const hop = Math.trunc(0.005 * sr) // 220 samples
  const fine = levelDb(y, 2 * hop, hop)
  const db = levelDb(y, 10 * hop, hop)

  const peak = max(fine)
  const a0 = fine.findIndex(v => v >= peak - 12)
  const start = Math.max(0, a0 * hop - Math.trunc(0.008 * sr))

  const dbMax = max(db)
  const endI = db.findLastIndex(v => v > dbMax - 30) + 1
  let runMax = db[a0]
  let dipI: number | undefined
  let reattackAt: number | undefined
  for (let i = a0 + 1; i < endI; i++) {
    if (db[i] > runMax && dipI === undefined) runMax = db[i]
    if (db[i] < runMax - 6 && (dipI === undefined || db[i] < db[dipI])) dipI = i
    if (dipI !== undefined && db[i] > db[dipI] + 4 && (i - a0) * hop > 0.06 * sr) {
      reattackAt = dipI
      break
    }
  }
  const end = (reattackAt ?? endI) * hop + hop
  return { start, end: Math.min(y.length, end), cutAtReattack: reattackAt !== undefined }
}

/**
 * `20 * log10(librosa.feature.rms(y, frame_length, hop_length) + 1e-9)`: centered frames (frame
 * `i` is centered on sample `i * hop`), zero-padded at both ends, `1 + n / hop` frames. Sums in
 * double precision like the Swift port.
 */
export function levelDb(y: Float32Array, frameLength: number, hop: number): Float64Array {
  const half = Math.floor(frameLength / 2)
  const count = 1 + Math.floor(y.length / hop)
  const out = new Float64Array(count)
  for (let t = 0; t < count; t++) {
    const lo = Math.max(0, t * hop - half)
    const hi = Math.min(y.length, t * hop - half + frameLength)
    let sum = 0
    for (let i = lo; i < hi; i++) sum += y[i] * y[i]
    out[t] = 20 * Math.log10(Math.sqrt(sum / frameLength) + 1e-9)
  }
  return out
}

function max(x: Float64Array): number {
  let m = Number.NEGATIVE_INFINITY
  for (const v of x) if (v > m) m = v
  return m
}
