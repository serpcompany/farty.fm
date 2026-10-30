import { hzToMidi, midiToHz } from './numeric'
import { Pyin, sharedPyin } from './pyin'
import { ANALYSIS_SAMPLE_RATE } from './resample'

/** The pitch half of `analyze_recording()` in the reference engine. */
export interface PitchAnalysis {
  /**
   * The smoothed pitch contour of the gesture in Hz, one value per 256-sample hop, NaN when
   * unvoiced (the reference's `f0`).
   */
  f0: Float64Array
  /**
   * The Recording Pitch estimate before audition, null if there were too few voiced frames or
   * the confidence was below `MINIMUM_CONFIDENCE`.
   */
  estimateMidi: number | null
  /** coverage × (1 − spread / 3), unrounded. */
  confidence: number
}

/** Loose on purpose: audition is the real gate (#208 raised it from 0.1). */
export const MINIMUM_CONFIDENCE = 0.2
/** Contour frames farther than this from the gesture's center, in semitones, are dropped. */
const FAR_FROM_CENTER = 6

/** Pitch contour, Recording Pitch estimate and pitch confidence of a gesture. */
export function analyzePitch(body: Float64Array): PitchAnalysis {
  const f0 = contour(body)
  const { midi, confidence } = estimate(body, f0)
  return { f0, estimateMidi: midi, confidence }
}

/**
 * pYIN over the gesture, then the reference's smoothing: keep every frame pYIN calls voiced,
 * attack included (#208); if at least 3, run a 5-frame median filter over the MIDI values with
 * unvoiced frames as 0 (scipy `reflect` edges), keep it only on voiced frames, and drop values at
 * or below MIDI 10 (the median landed on the zeros). If at least 3 are left, drop those more than
 * 6 semitones from their energy-weighted median: octave errors and glide tails, which the
 * renderer would bend toward.
 */
export function contour(body: Float64Array): Float64Array {
  const pyin = sharedPyin().run(body)
  const n = pyin.f0.length
  const f0 = new Float64Array(n)
  let finiteCount = 0
  for (let i = 0; i < n; i++) {
    f0[i] = pyin.voiced[i] ? pyin.f0[i] : Number.NaN
    if (Number.isFinite(f0[i])) finiteCount++
  }
  if (finiteCount < 3) return f0
  const midi = f0.map(v => (Number.isFinite(v) ? hzToMidi(v) : 0))
  const smoothed = medianFilter5(midi)
  const m = new Float64Array(n)
  const kept: number[] = []
  for (let i = 0; i < n; i++) {
    m[i] = Number.isFinite(f0[i]) && smoothed[i] > 10 ? smoothed[i] : Number.NaN
    if (Number.isFinite(m[i])) kept.push(i)
  }
  if (kept.length >= 3) {
    const rms = frameRms(body, Pyin.frameLength, Pyin.hopLength)
    const center = weightedMedian(
      kept.map(i => m[i]),
      kept.map(i => rms[i])
    )
    for (const i of kept) if (Math.abs(m[i] - center) > FAR_FROM_CENTER) m[i] = Number.NaN
  }
  for (let i = 0; i < n; i++) f0[i] = Number.isFinite(m[i]) ? midiToHz(m[i]) : Number.NaN
  return f0
}

/** How much of the contour the pitch estimate reads, in seconds (`PITCH_WINDOW_S`). */
const PITCH_WINDOW_SECONDS = 0.45

/**
 * Recording Pitch: the estimate over the first 450 ms (`estimateAt` from frame 0). Only when that
 * finds none, the estimate over the 450 ms from the contour's first kept frame, since a fart's
 * tone can come after its head (#282). A fart the head finds a pitch in never reaches the second.
 */
export function estimate(
  body: Float64Array,
  f0: Float64Array
): { midi: number | null; confidence: number } {
  const rms = frameRms(body, Pyin.frameLength, Pyin.hopLength)
  const head = estimateAt(body.length, f0, rms, 0)
  if (head.midi !== null) return head
  const firstKept = f0.findIndex(Number.isFinite)
  if (firstKept <= 0) return head
  const later = estimateAt(body.length, f0, rms, firstKept)
  return later.midi !== null ? later : head
}

/**
 * The estimate over the 450 ms from contour frame `from` (`estimate_pitch()` in the reference):
 * the energy-weighted median of its voiced frames, and its confidence, coverage × (1 − spread / 3).
 * Coverage is their share of the window, or of the frames left when less than 450 ms of the
 * gesture is left; spread is their median distance from the median. No estimate below 4 voiced
 * frames (confidence 0) or below `MINIMUM_CONFIDENCE`.
 */
function estimateAt(
  bodyLength: number,
  f0: Float64Array,
  rms: Float64Array,
  from: number
): { midi: number | null; confidence: number } {
  const sr = ANALYSIS_SAMPLE_RATE
  const hop = Pyin.hopLength
  const window = Math.trunc((PITCH_WINDOW_SECONDS * sr) / hop)
  const end = Math.min(f0.length, from + window)
  const voiced: number[] = []
  for (let i = from; i < end; i++) if (Number.isFinite(f0[i])) voiced.push(i)
  const frames = bodyLength - from * hop > PITCH_WINDOW_SECONDS * sr ? window : f0.length - from
  const coverage = voiced.length / Math.max(1, frames)
  if (voiced.length < 4) return { midi: null, confidence: 0 }

  const mids = voiced.map(i => hzToMidi(f0[i]))
  const median = weightedMedian(
    mids,
    voiced.map(i => rms[i])
  )
  const spread = npMedian(mids.map(m => Math.abs(m - median)))
  const confidence = clamp01(coverage) * clamp01(1 - spread / 3)
  return { midi: confidence >= MINIMUM_CONFIDENCE ? median : null, confidence }
}

/** The pitch below which half the weight lies (`weighted_median` in the reference). */
export function weightedMedian(mids: number[], weights: number[]): number {
  // A stable sort, so equal pitches keep frame order.
  const order = mids.map((_, i) => i).sort((a, b) => mids[a] - mids[b])
  const total = weights.reduce((s, w) => s + w, 0)
  let cumulative = 0
  for (const i of order) {
    cumulative += weights[i]
    if (cumulative / total >= 0.5) return mids[i]
  }
  return mids[order[order.length - 1]]
}

/** `librosa.feature.rms(y, frame_length, hop_length)`: centered, zero-padded frames. */
export function frameRms(y: Float64Array, frameLength: number, hop: number): Float64Array {
  const half = Math.floor(frameLength / 2)
  const out = new Float64Array(1 + Math.floor(y.length / hop))
  for (let t = 0; t < out.length; t++) {
    const lo = Math.max(0, t * hop - half)
    const hi = Math.min(y.length, t * hop - half + frameLength)
    let sum = 0
    for (let i = lo; i < hi; i++) sum += y[i] * y[i]
    out[t] = Math.sqrt(sum / frameLength)
  }
  return out
}

/** `scipy.ndimage.median_filter(x, size=5)` with the default `reflect` edges (d c b a | a b c d). */
export function medianFilter5(x: Float64Array): Float64Array {
  const n = x.length
  const at = (i: number) => {
    let j = i % (2 * n)
    if (j < 0) j += 2 * n
    return x[j < n ? j : 2 * n - 1 - j]
  }
  const out = new Float64Array(n)
  const w = new Float64Array(5)
  for (let i = 0; i < n; i++) {
    w[0] = at(i - 2)
    w[1] = at(i - 1)
    w[2] = x[i]
    w[3] = at(i + 1)
    w[4] = at(i + 2)
    out[i] = w.sort()[2]
  }
  return out
}

/** `np.median`. */
export function npMedian(x: number[]): number {
  const s = [...x].sort((a, b) => a - b)
  const n = s.length
  return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2
}

function clamp01(x: number): number {
  return Math.min(Math.max(x, 0), 1)
}
