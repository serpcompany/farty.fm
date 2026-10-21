import { exp2, hzToMidi, pairwiseSum } from './numeric'

// The part of `Resampling.swift` that audition needs: reading a Recording's own waveform at a
// variable rate. Fart-only (ADR 0004): every output sample is interpolated from the input
// Recording. The only operations are a low-pass filter before reading faster than 1x
// (anti-aliasing) and cubic interpolation.

/** Samples per pitch-contour frame. */
const HOP_LENGTH = 256

/**
 * Reads `x` at a rate that can change every 256 input samples; a rate above 1 raises the pitch.
 * Port of the reference engine's `variable_resample()`.
 *
 * - `f0`: the pitch contour in Hz, one value per hop of `x`, NaN when unvoiced.
 * - `ratio`: the constant rate, `2^(semitones / 12)`.
 * - `tune`: 0 keeps a constant rate; 1 makes the rate follow the contour so the note holds steady
 *   on `referenceMidi × ratio`. Deviations are clipped to ±5 semitones and interpolated across
 *   unvoiced frames.
 * - `outputLength`: how many samples to produce. Fewer come back if `x` runs out first.
 * - `referenceMidi`: the pitch the contour is pulled toward; null disables tuning.
 */
export function variableResample(
  x: Float64Array,
  f0: Float64Array,
  ratio: number,
  tune: number,
  outputLength: number,
  referenceMidi: number | null
): Float64Array {
  const nHops = f0.length
  let hopRate = new Float64Array(Math.max(1, nHops)).fill(ratio)
  if (tune > 0 && referenceMidi !== null && nHops > 0) {
    const known: number[] = []
    for (let i = 0; i < nHops; i++) if (Number.isFinite(f0[i])) known.push(i)
    if (known.length >= 2) {
      // Semitones toward the reference.
      const deviation = known.map(i => referenceMidi - hzToMidi(f0[i]))
      const interpolated = interp(nHops, known, deviation)
      hopRate = interpolated.map(d => ratio * exp2((tune * Math.min(Math.max(d, -5), 5)) / 12))
    }
  }

  // Anti-alias when reading faster than 1x.
  let source = x
  let fastest = Number.NEGATIVE_INFINITY
  for (const r of hopRate) if (r > fastest) fastest = r
  if (fastest > 1.02 && x.length > 3 * 9) {
    const { b, a } = butterworthLowpass(8, Math.min(0.95, 0.9 / fastest))
    source = filtfilt(b, a, x)
  }

  const positions: number[] = []
  let p = 0
  const end = source.length - 2
  for (let i = 0; i < Math.max(0, outputLength); i++) {
    if (p >= end) break
    positions.push(p)
    p += hopRate[Math.min(hopRate.length - 1, Math.trunc(p / HOP_LENGTH))]
  }
  return cubicRead(source, positions)
}

/**
 * Catmull-Rom cubic interpolation of `x` at fractional sample positions (indices outside `x` are
 * clamped to its ends). Port of the reference engine's `_cubic_read()`.
 */
export function cubicRead(x: Float64Array, positions: number[]): Float64Array {
  const out = new Float64Array(positions.length)
  if (x.length === 0) return out
  const last = x.length - 1
  const clamp = (i: number) => Math.min(Math.max(i, 0), last)
  for (let k = 0; k < positions.length; k++) {
    const pos = positions[k]
    const i = Math.floor(pos)
    const f = pos - i
    const xm1 = x[clamp(i - 1)]
    const x0 = x[clamp(i)]
    const x1 = x[clamp(i + 1)]
    const x2 = x[clamp(i + 2)]
    const c1 = 0.5 * (x1 - xm1)
    const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2
    const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1)
    out[k] = ((c3 * f + c2) * f + c1) * f + x0
  }
  return out
}

/**
 * `np.interp(arange(n), xp, fp)` for increasing integer `xp`: linear in between, the end values
 * outside.
 */
function interp(n: number, xp: number[], fp: number[]): Float64Array {
  const out = new Float64Array(n)
  let j = 0
  for (let v = 0; v < n; v++) {
    if (v < xp[0]) out[v] = fp[0]
    else if (v >= xp[xp.length - 1]) out[v] = fp[fp.length - 1]
    else {
      while (xp[j + 1] <= v) j++
      if (xp[j] === v) out[v] = fp[j]
      else {
        const slope = (fp[j + 1] - fp[j]) / (xp[j + 1] - xp[j])
        out[v] = slope * (v - xp[j]) + fp[j]
      }
    }
  }
  return out
}

type Complex = [re: number, im: number]

/**
 * `scipy.signal.butter(order, cutoff, btype="low")`: analog prototype poles (buttap), pre-warped
 * cutoff, lp2lp, then the bilinear transform and zpk2tf.
 */
export function butterworthLowpass(order: number, cutoff: number): { b: number[]; a: number[] } {
  const fs = 2
  const warped = 2 * fs * Math.tan((Math.PI * cutoff) / fs)
  const poles: Complex[] = []
  for (let m = -order + 1; m < order; m += 2) {
    const theta = (Math.PI * m) / (2 * order)
    poles.push([-Math.cos(theta) * warped, -Math.sin(theta) * warped])
  }
  const gain = warped ** order
  const fs2: Complex = [2 * fs, 0]
  const digitalPoles = poles.map(p => div(add(fs2, p), sub(fs2, p)))
  let denominator: Complex = [1, 0]
  for (const p of poles) denominator = mul(denominator, sub(fs2, p))
  const k = gain * div([1, 0], denominator)[0]

  // zpk2tf: b = k * poly(zeros at −1), a = poly(poles).
  let b: Complex[] = [[1, 0]]
  for (let i = 0; i < order; i++) b = convolveWithRoot(b, [-1, 0])
  let a: Complex[] = [[1, 0]]
  for (const p of digitalPoles) a = convolveWithRoot(a, p)
  return { b: b.map(c => k * c[0]), a: a.map(c => c[0]) }
}

/**
 * `scipy.signal.filtfilt(b, a, x)`: forward and backward, with odd extension of
 * 3 × max(len(a), len(b)) samples and steady-state initial conditions.
 */
export function filtfilt(b: number[], a: number[], x: Float64Array): Float64Array {
  const edge = 3 * Math.max(a.length, b.length)
  const n = x.length
  if (n <= edge) throw new RangeError(`filtfilt needs more than ${edge} samples`)
  const ext = new Float64Array(n + 2 * edge)
  for (let i = edge; i >= 1; i--) ext[edge - i] = 2 * x[0] - x[i]
  ext.set(x, edge)
  for (let i = 2; i <= edge + 1; i++) ext[n + edge + i - 2] = 2 * x[n - 1] - x[n - i]

  const zi = steadyState(b, a)
  const forward = lfilter(
    b,
    a,
    ext,
    zi.map(z => z * ext[0])
  ).reverse()
  const y0 = forward[0]
  const backward = lfilter(
    b,
    a,
    forward,
    zi.map(z => z * y0)
  ).reverse()
  return backward.slice(edge, edge + n)
}

/** `scipy.signal.lfilter_zi(b, a)` (scipy 1.18): the state for a unit step's steady state. */
function steadyState(b: number[], a: number[]): number[] {
  const yInf = pairwiseSum(b, 0, b.length) / pairwiseSum(a, 0, a.length)
  const v = b.map((bi, i) => bi - yInf * a[i])
  const zi = new Array<number>(v.length - 1).fill(0)
  let sum = v[v.length - 1]
  for (let k = v.length - 2; k >= 0; k--) {
    zi[k] = sum
    sum += v[k]
  }
  return zi
}

/** `scipy.signal.lfilter(b, a, x, zi=zi)` with `a[0] == 1`: direct form II transposed. */
function lfilter(b: number[], a: number[], x: Float64Array, zi: number[]): Float64Array {
  const z = Float64Array.from(zi)
  const order = b.length
  const y = new Float64Array(x.length)
  for (let i = 0; i < x.length; i++) {
    const xn = x[i]
    const yn = z[0] + b[0] * xn
    for (let n = 0; n < order - 2; n++) z[n] = z[n + 1] + xn * b[n + 1] - yn * a[n + 1]
    z[order - 2] = xn * b[order - 1] - yn * a[order - 1]
    y[i] = yn
  }
  return y
}

function convolveWithRoot(c: Complex[], root: Complex): Complex[] {
  const out: Complex[] = []
  for (let i = 0; i <= c.length; i++) {
    let s: Complex = [0, 0]
    if (i < c.length) s = add(s, c[i])
    if (i > 0) s = add(s, mul(c[i - 1], sub([0, 0], root)))
    out.push(s)
  }
  return out
}

const add = (l: Complex, r: Complex): Complex => [l[0] + r[0], l[1] + r[1]]
const sub = (l: Complex, r: Complex): Complex => [l[0] - r[0], l[1] - r[1]]
const mul = (l: Complex, r: Complex): Complex => [
  l[0] * r[0] - l[1] * r[1],
  l[0] * r[1] + l[1] * r[0]
]

/** Smith's algorithm, like numpy's complex division. */
function div(l: Complex, r: Complex): Complex {
  if (Math.abs(r[0]) >= Math.abs(r[1])) {
    const rat = r[1] / r[0]
    const scl = 1 / (r[0] + r[1] * rat)
    return [(l[0] + l[1] * rat) * scl, (l[1] - l[0] * rat) * scl]
  }
  const rat = r[0] / r[1]
  const scl = 1 / (r[1] + r[0] * rat)
  return [(l[0] * rat + l[1]) * scl, (l[1] * rat - l[0]) * scl]
}
