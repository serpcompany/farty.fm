export const ANALYSIS_SAMPLE_RATE = 44_100

const SOXR_HQ_BITS = 20
const REJECTION_DB = SOXR_HQ_BITS * 20 * Math.log10(2)
const PASSBAND_END = 1 - 0.05 / ((1.6e-6 * REJECTION_DB - 7.5e-4) * REJECTION_DB + 0.646)
const STOPBAND_BEGIN = 1
const KAISER_BETA = 0.1102 * (REJECTION_DB - 8.7)
const MAX_CACHED_PHASES = 2048

export function resampleToAnalysisRate(x: Float32Array, rate: number): Float32Array {
  if (!(rate > 0)) throw new RangeError(`Invalid sample rate ${rate}`)
  if (rate === ANALYSIS_SAMPLE_RATE) return x
  const outCount = Math.ceil((x.length * ANALYSIS_SAMPLE_RATE) / rate)
  const y = new Float32Array(outCount)
  if (x.length === 0) return y

  const rho = Math.min(1, ANALYSIS_SAMPLE_RATE / rate)
  const cutoff = (rho * (PASSBAND_END + STOPBAND_BEGIN)) / 2
  const transition = rho * (STOPBAND_BEGIN - PASSBAND_END)
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
  const coefficients = (frac: number, out: Float64Array): Float64Array => {
    for (let m = 0; m < 2 * taps; m++) out[m] = kernel(frac + taps - 1 - m)
    return out
  }

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
