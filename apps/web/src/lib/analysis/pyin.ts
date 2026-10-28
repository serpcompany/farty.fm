import { Autocorrelation } from './fft'
import { exp2, pairwiseSum, roundHalfEven } from './numeric'

export interface PyinOutput {
  f0: Float64Array
  voiced: Uint8Array
  voicedProbability: Float64Array
}

const SMALLEST_NORMAL = 2.2250738585072014e-308
const LOG_SMALLEST_NORMAL = Math.log(SMALLEST_NORMAL)
const THRESHOLDS = 100
const PITCH_RESOLUTION_SEMITONES = 0.1
const BOLTZMANN_PARAMETER = 2
const NO_TROUGH_PROBABILITY = 0.01
const MAX_TRANSITION_OCTAVES_PER_SECOND = 35.92
const VOICING_STAY_PROBABILITY = 0.99
const TRANSITION_MIN_PROBABILITY = 1e-4
const AUTOCORRELATION_LENGTH = 4096

export class Pyin {
  static readonly sampleRate = 44_100
  static readonly frameLength = 2048
  static readonly hopLength = 256
  static readonly fmin = 45
  static readonly fmax = 900

  readonly minPeriod: number
  readonly maxPeriod: number
  readonly pitchBins: number
  readonly binsPerOctave: number
  readonly freqs: Float64Array
  private readonly thresholds: Float64Array
  private readonly betaProbs: Float64Array
  private readonly betaHeadSums: Float64Array
  private readonly boltzmannFactor: Float64Array
  private readonly boltzmannDecay: Float64Array
  private readonly transitions: Transitions
  private readonly logInitial: number
  private readonly acf = new Autocorrelation(AUTOCORRELATION_LENGTH)

  constructor(fmax: number = Pyin.fmax) {
    const sr = Pyin.sampleRate
    this.minPeriod = Math.floor(sr / fmax)
    this.maxPeriod = Math.min(Math.ceil(sr / Pyin.fmin), Pyin.frameLength - 1)
    const binsPerSemitone = Math.ceil(1 / PITCH_RESOLUTION_SEMITONES)
    this.binsPerOctave = 12 * binsPerSemitone
    this.pitchBins = Math.floor(this.binsPerOctave * Math.log2(fmax / Pyin.fmin)) + 1

    this.thresholds = new Float64Array(THRESHOLDS + 1)
    for (let i = 0; i <= THRESHOLDS; i++) this.thresholds[i] = i * 0.01
    this.thresholds[THRESHOLDS] = 1
    const cdf = this.thresholds.map(betaTwoEighteenCdf)
    this.betaProbs = new Float64Array(THRESHOLDS)
    for (let j = 0; j < THRESHOLDS; j++) this.betaProbs[j] = cdf[j + 1] - cdf[j]
    this.betaHeadSums = new Float64Array(THRESHOLDS + 1)
    for (let n = 0; n <= THRESHOLDS; n++) {
      this.betaHeadSums[n] = pairwiseSum(this.betaProbs, 0, n)
    }

    const maxTroughs = this.maxPeriod - this.minPeriod + 2
    this.boltzmannFactor = new Float64Array(maxTroughs + 1)
    this.boltzmannDecay = new Float64Array(maxTroughs + 1)
    for (let n = 0; n <= maxTroughs; n++) {
      this.boltzmannFactor[n] =
        (1 - Math.exp(-BOLTZMANN_PARAMETER)) / (1 - Math.exp(-BOLTZMANN_PARAMETER * n))
      this.boltzmannDecay[n] = Math.exp(-BOLTZMANN_PARAMETER * n)
    }

    this.freqs = new Float64Array(this.pitchBins)
    for (let b = 0; b < this.pitchBins; b++) {
      this.freqs[b] = Pyin.fmin * exp2(b / this.binsPerOctave)
    }

    this.transitions = viterbiTransitions(this.pitchBins, binsPerSemitone)
    this.logInitial = Math.log(1 / (2 * this.pitchBins) + SMALLEST_NORMAL)
  }

  run(y: Float64Array): PyinOutput {
    const frameLength = Pyin.frameLength
    const hop = Pyin.hopLength
    const minPeriod = this.minPeriod
    const maxPeriod = this.maxPeriod
    const pitchBins = this.pitchBins
    const binsPerOctave = this.binsPerOctave
    const thresholds = this.thresholds
    const betaProbs = this.betaProbs
    const boltzmannFactor = this.boltzmannFactor
    const boltzmannDecay = this.boltzmannDecay
    const { offsets, sources, logProbabilities } = this.transitions
    const nFrames = 1 + Math.floor(y.length / hop)
    const nStates = 2 * pitchBins
    const nYin = maxPeriod - minPeriod + 1
    const sr = Pyin.sampleRate

    const padded = new Float64Array(y.length + frameLength)
    padded.set(y, frameLength / 2)

    const acf = new Float64Array(maxPeriod + 1)
    const energy = new Float64Array(maxPeriod)
    const diff = new Float64Array(maxPeriod + 1)
    const yin = new Float64Array(nYin)
    const shifts = new Float64Array(nYin)
    const troughs: number[] = []
    const firstThresholdAbove: number[] = []
    const countBelow = new Int32Array(THRESHOLDS)
    const troughProbs: number[] = []
    const obsVoiced = new Float64Array(pitchBins)
    const touched: number[] = []
    const logObs = new Float64Array(nStates)
    let value = new Float64Array(nStates)
    let next = new Float64Array(nStates)
    const ptr = new Uint16Array(nFrames * nStates)
    const voicedProbability = new Float64Array(nFrames)

    for (let t = 0; t < nFrames; t++) {
      const frame = t * hop
      this.acf.compute(padded, frame, frameLength, acf)
      cumulativeMeanNormalizedDifference(padded, frame, acf, energy, diff, minPeriod, yin)
      parabolicShifts(yin, shifts)
      findTroughs(yin, troughs)

      for (const b of touched) obsVoiced[b] = 0
      touched.length = 0
      let voicedProb = 0
      if (troughs.length > 0) {
        firstThresholdAbove.length = 0
        countBelow.fill(0)
        for (const idx of troughs) {
          const h = yin[idx]
          let j = 0
          while (j < THRESHOLDS && !(h < thresholds[j + 1])) j++
          firstThresholdAbove.push(j)
          if (j < THRESHOLDS) countBelow[j]++
        }
        for (let j = 1; j < THRESHOLDS; j++) countBelow[j] += countBelow[j - 1]
        troughProbs.length = 0
        for (let i = 0; i < troughs.length; i++) troughProbs.push(0)
        for (let j = 0; j < THRESHOLDS; j++) {
          const nBelow = countBelow[j]
          if (nBelow === 0) continue
          const factor = boltzmannFactor[nBelow]
          const beta = betaProbs[j]
          let rank = 0
          for (let ti = 0; ti < firstThresholdAbove.length; ti++) {
            if (firstThresholdAbove[ti] <= j) {
              troughProbs[ti] += factor * boltzmannDecay[rank] * beta
              rank++
            }
          }
        }
        let globalMin = 0
        for (let ti = 1; ti < troughs.length; ti++) {
          if (yin[troughs[ti]] < yin[troughs[globalMin]]) globalMin = ti
        }
        troughProbs[globalMin] +=
          NO_TROUGH_PROBABILITY * this.betaHeadSums[firstThresholdAbove[globalMin]]

        for (let ti = 0; ti < troughs.length; ti++) {
          if (troughProbs[ti] === 0) continue
          const idx = troughs[ti]
          const period = minPeriod + idx + shifts[idx]
          const f0 = sr / period
          const bin = Math.min(
            Math.max(roundHalfEven(binsPerOctave * Math.log2(f0 / Pyin.fmin)), 0),
            pitchBins
          )
          if (bin < pitchBins) {
            if (obsVoiced[bin] === 0) touched.push(bin)
            obsVoiced[bin] = troughProbs[ti]
          }
        }
        touched.sort((a, b) => a - b)
        let sum = 0
        for (const b of touched) sum += obsVoiced[b]
        voicedProb = Math.min(Math.max(sum, 0), 1)
      }
      voicedProbability[t] = voicedProb

      logObs.fill(LOG_SMALLEST_NORMAL, 0, pitchBins)
      for (const b of touched) logObs[b] = Math.log(obsVoiced[b] + SMALLEST_NORMAL)
      logObs.fill(Math.log((1 - voicedProb) / pitchBins + SMALLEST_NORMAL), pitchBins, nStates)

      if (t === 0) {
        for (let s = 0; s < nStates; s++) value[s] = logObs[s] + this.logInitial
        continue
      }
      const row = t * nStates
      for (let j = 0; j < nStates; j++) {
        let best = Number.NEGATIVE_INFINITY
        let bestK = 0
        for (let q = offsets[j]; q < offsets[j + 1]; q++) {
          const k = sources[q]
          const cost = value[k] + logProbabilities[q]
          if (cost > best) {
            best = cost
            bestK = k
          }
        }
        ptr[row + j] = bestK
        next[j] = logObs[j] + best
      }
      const swap = value
      value = next
      next = swap
    }

    const states = backtrack(value, ptr, nFrames, nStates)
    const f0 = new Float64Array(nFrames)
    const voiced = new Uint8Array(nFrames)
    for (let t = 0; t < nFrames; t++) {
      voiced[t] = states[t] < pitchBins ? 1 : 0
      f0[t] = voiced[t] ? this.freqs[states[t]] : Number.NaN
    }
    return { f0, voiced, voicedProbability }
  }
}

interface Transitions {
  offsets: Int32Array
  sources: Int32Array
  logProbabilities: Float64Array
}

function betaTwoEighteenCdf(x: number): number {
  return 1 - (1 - x) ** 19 - 19 * x * (1 - x) ** 18
}

function viterbiTransitions(pitchBins: number, binsPerSemitone: number): Transitions {
  const maxSemitonesPerFrame = roundHalfEven(
    (MAX_TRANSITION_OCTAVES_PER_SECOND * 12 * Pyin.hopLength) / Pyin.sampleRate
  )
  const width = maxSemitonesPerFrame * binsPerSemitone + 1
  const half = Math.floor(width / 2)
  const n = pitchBins
  const risingTriangle = Array.from({ length: half + 1 }, (_, i) => (2 * (i + 1)) / (width + 1))
  const weightAtDistance = (d: number) => risingTriangle[half - d]
  const rowSum = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) {
      s += weightAtDistance(Math.abs(i - j))
    }
    rowSum[i] = s
  }
  const switchProbability = 1 - VOICING_STAY_PROBABILITY
  const logThreshold = Math.log(TRANSITION_MIN_PROBABILITY + SMALLEST_NORMAL)
  const offsets = [0]
  const sources: number[] = []
  const logProbabilities: number[] = []
  for (let target = 0; target < 2 * n; target++) {
    const targetVoiced = target < n
    const targetBin = target % n
    for (let source = 0; source < 2 * n; source++) {
      const sourceVoiced = source < n
      const sourceBin = source % n
      const d = Math.abs(sourceBin - targetBin)
      if (d > half) continue
      const voicing = sourceVoiced === targetVoiced ? VOICING_STAY_PROBABILITY : switchProbability
      const p = voicing * (weightAtDistance(d) / rowSum[sourceBin])
      const lp = Math.log(p + SMALLEST_NORMAL)
      if (lp >= logThreshold) {
        sources.push(source)
        logProbabilities.push(lp)
      }
    }
    offsets.push(sources.length)
  }
  return {
    offsets: Int32Array.from(offsets),
    sources: Int32Array.from(sources),
    logProbabilities: Float64Array.from(logProbabilities)
  }
}

function cumulativeMeanNormalizedDifference(
  padded: Float64Array,
  frame: number,
  acf: Float64Array,
  energy: Float64Array,
  diff: Float64Array,
  minPeriod: number,
  yin: Float64Array
): void {
  const maxPeriod = energy.length
  let e = 0
  for (let m = 0; m < maxPeriod; m++) {
    e += padded[frame + m] * padded[frame + m]
    energy[m] = e
  }
  const acf0 = acf[0]
  diff[0] = 0
  diff[1] = 2 * (acf0 - acf[1])
  for (let k = 2; k <= maxPeriod; k++) diff[k] = 2 * (acf0 - acf[k]) - energy[k - 1]
  let cumulative = 0
  for (let k = 1; k <= maxPeriod; k++) {
    cumulative += diff[k]
    if (k >= minPeriod) yin[k - minPeriod] = diff[k] / (cumulative / k + SMALLEST_NORMAL)
  }
}

function parabolicShifts(yin: Float64Array, shifts: Float64Array): void {
  const n = yin.length
  shifts[0] = 0
  shifts[n - 1] = 0
  for (let i = 1; i < n - 1; i++) {
    const a = yin[i + 1] + yin[i - 1] - 2 * yin[i]
    const b = (yin[i + 1] - yin[i - 1]) / 2
    shifts[i] = Math.abs(b) >= Math.abs(a) ? 0 : -b / a
  }
}

function findTroughs(yin: Float64Array, troughs: number[]): void {
  const n = yin.length
  troughs.length = 0
  if (yin[0] < yin[1]) troughs.push(0)
  for (let i = 1; i < n - 1; i++) {
    if (yin[i] < yin[i - 1] && yin[i] <= yin[i + 1]) troughs.push(i)
  }
  if (yin[n - 1] < yin[n - 2]) troughs.push(n - 1)
}

function backtrack(
  finalValue: Float64Array,
  ptr: Uint16Array,
  nFrames: number,
  nStates: number
): Int32Array {
  let state = 0
  for (let s = 1; s < nStates; s++) if (finalValue[s] > finalValue[state]) state = s
  const states = new Int32Array(nFrames)
  states[nFrames - 1] = state
  for (let t = nFrames - 2; t >= 0; t--) states[t] = ptr[(t + 1) * nStates + states[t + 1]]
  return states
}

let shared: Pyin | undefined
export function sharedPyin(): Pyin {
  shared ??= new Pyin()
  return shared
}
