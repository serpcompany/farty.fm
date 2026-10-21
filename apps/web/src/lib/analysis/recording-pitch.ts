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

/** Loose on purpose: audition is the real gate. */
export const MINIMUM_CONFIDENCE = 0.1
/** Voiced probability a frame needs, on top of pYIN's own voicing decision. */
const MINIMUM_VOICED_PROBABILITY = 0.05

/** Pitch contour, Recording Pitch estimate and pitch confidence of a gesture. */
export function analyzePitch(body: Float64Array): PitchAnalysis {
  const f0 = contour(body)
  const { midi, confidence } = estimate(body, f0)
  return { f0, estimateMidi: midi, confidence }
}

/**
 * pYIN over the gesture, then the reference's smoothing: keep frames voiced with probability
 * above 0.05; if at least 3, run a 5-frame median filter over the MIDI values with unvoiced frames
 * as 0 (scipy `reflect` edges), keep it only on voiced frames, and drop values at or below MIDI
 * 10 (the median landed on the zeros).
 */
export function contour(body: Float64Array): Float64Array {
  const pyin = sharedPyin().run(body)
  const n = pyin.f0.length
  const f0 = new Float64Array(n)
  let finiteCount = 0
  for (let i = 0; i < n; i++) {
    const keep = pyin.voiced[i] && pyin.voicedProbability[i] > MINIMUM_VOICED_PROBABILITY
    f0[i] = keep ? pyin.f0[i] : Number.NaN
    if (Number.isFinite(f0[i])) finiteCount++
  }
  if (finiteCount < 3) return f0
  const midi = f0.map(v => (Number.isFinite(v) ? hzToMidi(v) : 0))
  const smoothed = medianFilter5(midi)
  for (let i = 0; i < n; i++) {
    const m = Number.isFinite(f0[i]) ? smoothed[i] : Number.NaN
    f0[i] = Number.isFinite(m) && m > 10 ? midiToHz(m) : Number.NaN
  }
  return f0
}

/**
 * Recording Pitch: the energy-weighted median of the voiced frames in the first 450 ms.
 * Confidence: coverage × (1 − spread / 3), spread being the median distance from it.
 */
export function estimate(
  body: Float64Array,
  f0: Float64Array
): { midi: number | null; confidence: number } {
  const sr = ANALYSIS_SAMPLE_RATE
  const hop = Pyin.hopLength
  const head = Math.min(f0.length, Math.trunc((0.45 * sr) / hop))
  const voiced: number[] = []
  for (let i = 0; i < head; i++) if (Number.isFinite(f0[i])) voiced.push(i)
  const coverage = voiced.length / Math.max(1, body.length > 0.45 * sr ? head : f0.length)
  if (voiced.length < 4) return { midi: null, confidence: 0 }

  const rms = frameRms(body, Pyin.frameLength, hop)
  const mids = voiced.map(i => hzToMidi(f0[i]))
  const weights = voiced.map(i => rms[i])
  // A stable sort, so equal pitches keep frame order.
  const order = mids.map((_, i) => i).sort((a, b) => mids[a] - mids[b])
  const total = weights.reduce((s, w) => s + w, 0)
  let cumulative = 0
  let medianIndex = order[order.length - 1]
  for (const i of order) {
    cumulative += weights[i]
    if (cumulative / total >= 0.5) {
      medianIndex = i
      break
    }
  }
  const median = mids[medianIndex]
  const spread = npMedian(mids.map(m => Math.abs(m - median)))
  const confidence = clamp01(coverage) * clamp01(1 - spread / 3)
  return { midi: confidence >= MINIMUM_CONFIDENCE ? median : null, confidence }
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
