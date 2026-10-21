import { Autocorrelation } from './fft'
import { exp2, pairwiseSum, roundHalfEven } from './numeric'

export interface PyinOutput {
  /** Hz per frame, NaN when unvoiced. */
  f0: Float64Array
  voiced: Uint8Array
  voicedProbability: Float64Array
}

/** `np.finfo(np.float64).tiny`, librosa's `util.tiny`: the smallest normal double. */
const TINY = 2.2250738585072014e-308
const LOG_TINY = Math.log(TINY)

/**
 * Probabilistic YIN pitch tracking: a step-by-step port of librosa 1.0.0's
 * `pyin(y, fmin=45, fmax=900, sr=44100, frame_length=2048, hop_length=256)` with all of
 * librosa's other defaults (centered, zero-padded frames; 100 thresholds with a Beta(2, 18)
 * prior; Boltzmann trough prior 2; 0.1-semitone pitch bins starting at fmin; a voicing HMM with
 * 35.92 octaves/s maximum transition rate, switch probability 0.01, decoded with Viterbi over
 * transitions of probability at least 1e-4). Mirrors `PYIN.swift`.
 *
 * The pitch grid matters: Recording Pitches sit on it (MIDI x.x259), so the port keeps the
 * reference's bins, its rounding (half to even) and its tie-breaking.
 */
export class Pyin {
  static readonly sampleRate = 44_100
  static readonly frameLength = 2048
  static readonly hopLength = 256
  static readonly fmin = 45
  /**
   * The highest pitch Recording Analysis looks for. The render checks (`evaluate.py`) read
   * renders back with a 1200 Hz ceiling instead.
   */
  static readonly fmax = 900

  readonly minPeriod: number
  readonly maxPeriod: number
  readonly pitchBins: number
  readonly binsPerOctave: number
  /** Bin center frequencies. */
  readonly freqs: Float64Array
  private readonly thresholds: Float64Array
  private readonly betaProbs: Float64Array
  /** `beta_probs[:n].sum()` for every n. */
  private readonly betaHeadSums: Float64Array
  /** Boltzmann normalization `(1 − e^−2) / (1 − e^(−2N))` for N troughs. */
  private readonly boltzmannFactor: Float64Array
  /** `e^(−2k)`. */
  private readonly boltzmannDecay: Float64Array
  /** Viterbi predecessors of each state (voiced bins, then unvoiced bins), ascending. */
  private readonly predOffsets: Int32Array
  private readonly predStates: Int32Array
  private readonly predLogTransition: Float64Array
  private readonly logInitial: number
  private readonly acf = new Autocorrelation(4096)

  constructor(fmax: number = Pyin.fmax) {
    const sr = Pyin.sampleRate
    this.minPeriod = Math.floor(sr / fmax)
    this.maxPeriod = Math.min(Math.ceil(sr / Pyin.fmin), Pyin.frameLength - 1)
    const binsPerSemitone = Math.ceil(1 / 0.1)
    this.binsPerOctave = 12 * binsPerSemitone
    this.pitchBins = Math.floor(this.binsPerOctave * Math.log2(fmax / Pyin.fmin)) + 1

    // Prior over thresholds: np.diff(scipy.stats.beta.cdf(np.linspace(0, 1, 101), 2, 18)).
    // For integer shape parameters the regularized incomplete beta function has a closed form:
    // I_x(2, 18) = 1 − (1−x)^19 − 19 x (1−x)^18.
    this.thresholds = new Float64Array(101)
    for (let i = 0; i <= 100; i++) this.thresholds[i] = i * 0.01
    this.thresholds[100] = 1
    const cdf = this.thresholds.map(x => 1 - (1 - x) ** 19 - 19 * x * (1 - x) ** 18)
    this.betaProbs = new Float64Array(100)
    for (let j = 0; j < 100; j++) this.betaProbs[j] = cdf[j + 1] - cdf[j]
    this.betaHeadSums = new Float64Array(101)
    for (let n = 0; n <= 100; n++) this.betaHeadSums[n] = pairwiseSum(this.betaProbs, 0, n)

    const maxTroughs = this.maxPeriod - this.minPeriod + 2
    this.boltzmannFactor = new Float64Array(maxTroughs + 1)
    this.boltzmannDecay = new Float64Array(maxTroughs + 1)
    for (let n = 0; n <= maxTroughs; n++) {
      this.boltzmannFactor[n] = (1 - Math.exp(-2)) / (1 - Math.exp(-2 * n))
      this.boltzmannDecay[n] = Math.exp(-2 * n)
    }

    this.freqs = new Float64Array(this.pitchBins)
    for (let b = 0; b < this.pitchBins; b++) {
      this.freqs[b] = Pyin.fmin * exp2(b / this.binsPerOctave)
    }

    // Transition matrix: a triangular local window within voiced and within unvoiced bins
    // (sequence.transition_local), times the voicing switch (transition_loop(2, 0.99)).
    const maxSemitonesPerFrame = roundHalfEven((35.92 * 12 * Pyin.hopLength) / sr)
    const width = maxSemitonesPerFrame * binsPerSemitone + 1
    const half = Math.floor(width / 2)
    const n = this.pitchBins
    // scipy triang, rising half: window[half − d] is the weight at distance d.
    const window = Array.from({ length: half + 1 }, (_, i) => (2 * (i + 1)) / (width + 1))
    const w = (d: number) => window[half - d]
    const rowSum = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      let s = 0
      for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) {
        s += w(Math.abs(i - j))
      }
      rowSum[i] = s
    }
    const stay = 0.99
    const switchProb = (1 - stay) / 1
    const logThreshold = Math.log(1e-4 + TINY)
    const offsets = [0]
    const states: number[] = []
    const logs: number[] = []
    for (let target = 0; target < 2 * n; target++) {
      const tv = target < n
      const tj = target % n
      for (let source = 0; source < 2 * n; source++) {
        const sv = source < n
        const si = source % n
        const d = Math.abs(si - tj)
        if (d > half) continue
        const p = (sv === tv ? stay : switchProb) * (w(d) / rowSum[si])
        const lp = Math.log(p + TINY)
        if (lp >= logThreshold) {
          states.push(source)
          logs.push(lp)
        }
      }
      offsets.push(states.length)
    }
    this.predOffsets = Int32Array.from(offsets)
    this.predStates = Int32Array.from(states)
    this.predLogTransition = Float64Array.from(logs)
    this.logInitial = Math.log(1 / (2 * n) + TINY)
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
    const predOffsets = this.predOffsets
    const predStates = this.predStates
    const predLogTransition = this.predLogTransition
    const nFrames = 1 + Math.floor(y.length / hop)
    const nStates = 2 * pitchBins
    const nYin = maxPeriod - minPeriod + 1
    const sr = Pyin.sampleRate

    // Zero-padded signal so frame t is centered on y[t * hop].
    const padded = new Float64Array(y.length + frameLength)
    padded.set(y, frameLength / 2)

    const acf = new Float64Array(maxPeriod + 1)
    const energy = new Float64Array(maxPeriod)
    const diff = new Float64Array(maxPeriod + 1)
    const yin = new Float64Array(nYin)
    const shifts = new Float64Array(nYin)
    const troughs: number[] = []
    const firstBelow: number[] = []
    const troughProbs: number[] = []
    const countBelow = new Int32Array(100)
    const obsVoiced = new Float64Array(pitchBins)
    const touched: number[] = []
    const logObs = new Float64Array(nStates)
    let value = new Float64Array(nStates)
    let next = new Float64Array(nStates)
    const ptr = new Uint16Array(nFrames * nStates)
    const voicedProbability = new Float64Array(nFrames)

    for (let t = 0; t < nFrames; t++) {
      const frame = t * hop
      // 1. Autocorrelation of the frame (librosa.autocorrelate, via FFT).
      this.acf.compute(padded, frame, frameLength, acf)

      // 2. Cumulative mean normalized difference (_cumulative_mean_normalized_difference).
      let e = 0
      for (let m = 0; m < maxPeriod; m++) {
        e += padded[frame + m] * padded[frame + m]
        energy[m] = e
      }
      const acf0 = acf[0]
      diff[0] = 0
      // librosa zeroes the first energy term before using it: d(1) subtracts 0.
      diff[1] = 2 * (acf0 - acf[1]) - 0
      for (let k = 2; k <= maxPeriod; k++) diff[k] = 2 * (acf0 - acf[k]) - energy[k - 1]
      let cumulative = 0
      for (let k = 1; k <= maxPeriod; k++) {
        cumulative += diff[k]
        if (k >= minPeriod) yin[k - minPeriod] = diff[k] / (cumulative / k + TINY)
      }

      // 3. Parabolic interpolation offsets (_parabolic_interpolation).
      shifts[0] = 0
      shifts[nYin - 1] = 0
      for (let i = 1; i < nYin - 1; i++) {
        const a = yin[i + 1] + yin[i - 1] - 2 * yin[i]
        const b = (yin[i + 1] - yin[i - 1]) / 2
        shifts[i] = Math.abs(b) >= Math.abs(a) ? 0 : -b / a
      }

      // 4. Troughs and their probabilities (__pyin_helper).
      troughs.length = 0
      if (yin[0] < yin[1]) troughs.push(0)
      for (let i = 1; i < nYin - 1; i++) {
        if (yin[i] < yin[i - 1] && yin[i] <= yin[i + 1]) troughs.push(i)
      }
      if (yin[nYin - 1] < yin[nYin - 2]) troughs.push(nYin - 1)

      for (const b of touched) obsVoiced[b] = 0
      touched.length = 0
      let voicedProb = 0
      if (troughs.length > 0) {
        // firstBelow[i]: the first threshold index j with height < thresholds[j + 1].
        firstBelow.length = 0
        countBelow.fill(0)
        for (const idx of troughs) {
          const h = yin[idx]
          let j = 0
          while (j < 100 && !(h < thresholds[j + 1])) j++
          firstBelow.push(j)
          if (j < 100) countBelow[j]++
        }
        for (let j = 1; j < 100; j++) countBelow[j] += countBelow[j - 1]
        troughProbs.length = 0
        for (let i = 0; i < troughs.length; i++) troughProbs.push(0)
        for (let j = 0; j < 100; j++) {
          const nBelow = countBelow[j]
          if (nBelow === 0) continue
          const factor = boltzmannFactor[nBelow]
          const beta = betaProbs[j]
          let rank = 0
          for (let ti = 0; ti < firstBelow.length; ti++) {
            if (firstBelow[ti] <= j) {
              troughProbs[ti] += factor * boltzmannDecay[rank] * beta
              rank++
            }
          }
        }
        let globalMin = 0
        for (let ti = 1; ti < troughs.length; ti++) {
          if (yin[troughs[ti]] < yin[troughs[globalMin]]) globalMin = ti
        }
        troughProbs[globalMin] += 0.01 * this.betaHeadSums[firstBelow[globalMin]]

        // Pitch bin of each candidate; later (longer-period) candidates overwrite.
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

      // 5. One Viterbi step (sequence.viterbi with transition_min_prob=1e-4).
      logObs.fill(LOG_TINY, 0, pitchBins)
      for (const b of touched) logObs[b] = Math.log(obsVoiced[b] + TINY)
      logObs.fill(Math.log((1 - voicedProb) / pitchBins + TINY), pitchBins, nStates)

      if (t === 0) {
        for (let s = 0; s < nStates; s++) value[s] = logObs[s] + this.logInitial
        continue
      }
      const row = t * nStates
      for (let j = 0; j < nStates; j++) {
        let best = Number.NEGATIVE_INFINITY
        let bestK = 0
        for (let q = predOffsets[j]; q < predOffsets[j + 1]; q++) {
          const k = predStates[q]
          const cost = value[k] + predLogTransition[q]
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

    // Backtrack from the best final state (first maximum).
    let state = 0
    for (let s = 1; s < nStates; s++) if (value[s] > value[state]) state = s
    const states = new Int32Array(nFrames)
    states[nFrames - 1] = state
    for (let t = nFrames - 2; t >= 0; t--) states[t] = ptr[(t + 1) * nStates + states[t + 1]]

    const f0 = new Float64Array(nFrames)
    const voiced = new Uint8Array(nFrames)
    for (let t = 0; t < nFrames; t++) {
      voiced[t] = states[t] < pitchBins ? 1 : 0
      f0[t] = voiced[t] ? this.freqs[states[t]] : Number.NaN
    }
    return { f0, voiced, voicedProbability }
  }
}

let shared: Pyin | undefined
/** The analysis pYIN (45 to 900 Hz), built once: its transition table takes a few ms. */
export function sharedPyin(): Pyin {
  shared ??= new Pyin()
  return shared
}
