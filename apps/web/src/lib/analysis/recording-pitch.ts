import { frameRms } from './frame-rms'
import { hzToMidi, midiToHz } from './numeric'
import { Pyin, sharedPyin } from './pyin'
import { ANALYSIS_SAMPLE_RATE } from './resample'

interface PitchAnalysis {
  f0: Float64Array
  estimateMidi: number | null
  confidence: number
}

const MINIMUM_CONFIDENCE = 0.2
const FAR_FROM_CENTER_SEMITONES = 6
const MEDIAN_LANDED_ON_UNVOICED_MIDI = 10
const FEWEST_SMOOTHABLE_FRAMES = 3
const FEWEST_ESTIMATE_FRAMES = 4
const ESTIMATE_HEAD_SECONDS = 0.45
const SPREAD_OF_ZERO_CONFIDENCE_SEMITONES = 3

export function analyzePitch(body: Float64Array): PitchAnalysis {
  const f0 = contour(body)
  const { midi, confidence } = estimate(body, f0)
  return { f0, estimateMidi: midi, confidence }
}

function contour(body: Float64Array): Float64Array {
  const pyin = sharedPyin().run(body)
  const n = pyin.f0.length
  const f0 = new Float64Array(n)
  let finiteCount = 0
  for (let i = 0; i < n; i++) {
    f0[i] = pyin.voiced[i] ? pyin.f0[i] : Number.NaN
    if (Number.isFinite(f0[i])) finiteCount++
  }
  if (finiteCount < FEWEST_SMOOTHABLE_FRAMES) return f0
  const midiWithUnvoicedAsZero = f0.map(v => (Number.isFinite(v) ? hzToMidi(v) : 0))
  const smoothed = medianFilter5(midiWithUnvoicedAsZero)
  const m = new Float64Array(n)
  const kept: number[] = []
  for (let i = 0; i < n; i++) {
    m[i] =
      Number.isFinite(f0[i]) && smoothed[i] > MEDIAN_LANDED_ON_UNVOICED_MIDI
        ? smoothed[i]
        : Number.NaN
    if (Number.isFinite(m[i])) kept.push(i)
  }
  if (kept.length >= FEWEST_SMOOTHABLE_FRAMES) {
    const rms = frameRms(body, Pyin.frameLength, Pyin.hopLength)
    const center = weightedMedian(
      kept.map(i => m[i]),
      kept.map(i => rms[i])
    )
    for (const i of kept) {
      if (Math.abs(m[i] - center) > FAR_FROM_CENTER_SEMITONES) m[i] = Number.NaN
    }
  }
  for (let i = 0; i < n; i++) f0[i] = Number.isFinite(m[i]) ? midiToHz(m[i]) : Number.NaN
  return f0
}

function estimate(
  body: Float64Array,
  f0: Float64Array
): { midi: number | null; confidence: number } {
  const sr = ANALYSIS_SAMPLE_RATE
  const hop = Pyin.hopLength
  const head = Math.min(f0.length, Math.trunc((ESTIMATE_HEAD_SECONDS * sr) / hop))
  const voiced: number[] = []
  for (let i = 0; i < head; i++) if (Number.isFinite(f0[i])) voiced.push(i)
  const framesConsidered = body.length > ESTIMATE_HEAD_SECONDS * sr ? head : f0.length
  const coverage = voiced.length / Math.max(1, framesConsidered)
  if (voiced.length < FEWEST_ESTIMATE_FRAMES) return { midi: null, confidence: 0 }

  const rms = frameRms(body, Pyin.frameLength, hop)
  const mids = voiced.map(i => hzToMidi(f0[i]))
  const median = weightedMedian(
    mids,
    voiced.map(i => rms[i])
  )
  const spread = npMedian(mids.map(m => Math.abs(m - median)))
  const confidence = clamp01(coverage) * clamp01(1 - spread / SPREAD_OF_ZERO_CONFIDENCE_SEMITONES)
  return { midi: confidence >= MINIMUM_CONFIDENCE ? median : null, confidence }
}

function weightedMedian(mids: number[], weights: number[]): number {
  const stableOrder = mids.map((_, i) => i).sort((a, b) => mids[a] - mids[b])
  const total = weights.reduce((s, w) => s + w, 0)
  let cumulative = 0
  for (const i of stableOrder) {
    cumulative += weights[i]
    if (cumulative / total >= 0.5) return mids[i]
  }
  return mids[stableOrder[stableOrder.length - 1]]
}

function medianFilter5(x: Float64Array): Float64Array {
  const n = x.length
  const reflected = (i: number) => {
    let j = i % (2 * n)
    if (j < 0) j += 2 * n
    return x[j < n ? j : 2 * n - 1 - j]
  }
  const out = new Float64Array(n)
  const w = new Float64Array(5)
  for (let i = 0; i < n; i++) {
    w[0] = reflected(i - 2)
    w[1] = reflected(i - 1)
    w[2] = x[i]
    w[3] = reflected(i + 1)
    w[4] = reflected(i + 2)
    out[i] = w.sort()[2]
  }
  return out
}

export function npMedian(x: number[]): number {
  const s = [...x].sort((a, b) => a - b)
  const n = s.length
  return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2
}

function clamp01(x: number): number {
  return Math.min(Math.max(x, 0), 1)
}
