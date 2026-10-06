/** The sample rate every analysis stage works at, like the reference engine (`SR`). */
export const ANALYSIS_SAMPLE_RATE = 44_100

// The reference resamples with soxr `soxr_hq` (librosa.load's default): a linear-phase low-pass
// that is flat to 91.36% of the lower Nyquist frequency and reaches 20-bit (120.4 dB) rejection
// at Nyquist. These are soxr's own numbers for that quality: rejection = 20 bits × 6.02 dB, and
// passband end = 1 − 0.05 / TO_3dB(rejection).
const REJECTION_DB = 20 * 20 * Math.log10(2)
const PASSBAND_END = 1 - 0.05 / ((1.6e-6 * REJECTION_DB - 7.5e-4) * REJECTION_DB + 0.646)
const STOPBAND_BEGIN = 1
const KAISER_BETA = 0.1102 * (REJECTION_DB - 8.7)
/** Phase tables up to this many phases are cached; 48 kHz needs 147. */
const MAX_CACHED_PHASES = 2048

/**
 * Resamples mono audio to 44.1 kHz, band-limited and with no added latency, the way
 * `librosa.load(sr=44100)` does with soxr. Mirrors `AudioDecoder.resample` in the Swift port.
 *
 * The output has `ceil(n * 44100 / rate)` samples (librosa's `fix_length`), and output sample
 * `k` sits at input time `k * rate / 44100`. Each output sample is a Kaiser-windowed sinc
 * interpolation of the input (zeros outside it), cut off midway through soxr's transition band.
 * The result is rounded to float32 like the reference's decoded audio.
 */
export function resampleToAnalysisRate(x: Float32Array, rate: number): Float32Array {
  if (!(rate > 0)) throw new RangeError(`Invalid sample rate ${rate}`)
  if (rate === ANALYSIS_SAMPLE_RATE) return x
  const outCount = Math.ceil((x.length * ANALYSIS_SAMPLE_RATE) / rate)
  const y = new Float32Array(outCount)
  if (x.length === 0) return y

  // Cutoff and transition width as fractions of the input Nyquist frequency.
  const rho = Math.min(1, ANALYSIS_SAMPLE_RATE / rate)
  const cutoff = (rho * (PASSBAND_END + STOPBAND_BEGIN)) / 2
  const transition = rho * (STOPBAND_BEGIN - PASSBAND_END)
  // Kaiser's length estimate, in input samples: (A − 7.95) / (2.285 · Δω).
  const halfWidth = (REJECTION_DB - 7.95) / (2.285 * Math.PI * transition) / 2
  const taps = Math.ceil(halfWidth)
  const window0 = besselI0(KAISER_BETA)

  const kernel = (d: number): number => {
    const r = d / halfWidth
    if (r <= -1 || r >= 1) return 0
    const w = besselI0(KAISER_BETA * Math.sqrt(1 - r * r)) / window0
    const a = Math.PI * cutoff * d
    return cutoff * (a === 0 ? 1 : Math.sin(a) / a) * w
  }
  // Coefficients for an output that falls `frac` input samples after input sample i: taps on
  // inputs i − taps + 1 … i + taps.
  const coefficients = (frac: number, out: Float64Array): Float64Array => {
    for (let m = 0; m < 2 * taps; m++) out[m] = kernel(frac + taps - 1 - m)
    return out
  }

  // An integer rate makes the step rational, L/M in lowest terms, so only L distinct phases
  // occur: 147 for 48 kHz. Their coefficients are computed once. Other rates (rare) compute
  // each output's coefficients on the fly.
  const g = Number.isInteger(rate) ? gcd(ANALYSIS_SAMPLE_RATE, rate) : 0
  const up = g > 0 ? ANALYSIS_SAMPLE_RATE / g : 0
  const down = g > 0 ? rate / g : 0
  const cached = g > 0 && up <= MAX_CACHED_PHASES
  const table = new Float64Array(cached ? up * 2 * taps : 2 * taps)
  if (cached) {
    for (let p = 0; p < up; p++) {
      coefficients(p / up, table.subarray(p * 2 * taps, (p + 1) * 2 * taps))
    }
  }

  const n = x.length
  for (let k = 0; k < outCount; k++) {
    let i: number
    let offset = 0
    if (cached) {
      const num = k * down
      i = Math.floor(num / up)
      offset = (num - i * up) * 2 * taps
    } else {
      const t = (k * rate) / ANALYSIS_SAMPLE_RATE
      i = Math.floor(t)
      coefficients(t - i, table)
    }
    const first = i - taps + 1
    const lo = Math.max(0, first)
    const hi = Math.min(n, i + taps + 1)
    let sum = 0
    for (let j = lo; j < hi; j++) sum += x[j] * table[offset + j - first]
    y[k] = sum
  }
  return y
}

/** Modified Bessel function of the first kind, order 0 (power series). */
function besselI0(x: number): number {
  const q = (x * x) / 4
  let term = 1
  let sum = 1
  for (let k = 1; term > sum * 1e-17; k++) {
    term *= q / (k * k)
    sum += term
  }
  return sum
}

function gcd(a: number, b: number): number {
  while (b !== 0) [a, b] = [b, a % b]
  return a
}
