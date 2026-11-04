/**
 * Integrated loudness in LUFS (ITU-R BS.1770-4) of mono audio, measured as one channel, as the
 * reference's `loudness()` (tools/melody-lab/evaluate.py) does: K-weighting, the mean square of
 * 400 ms blocks every 100 ms, then the -70 LUFS absolute gate and the -10 LU relative gate. Phone
 * media plays at about -14 LUFS (#369).
 */
export function loudness(samples: ArrayLike<number>, sampleRate: number): number {
  const weighted = biquad(
    biquad(Float64Array.from(samples), highShelf(sampleRate)),
    highPass(sampleRate)
  )
  const block = Math.round(0.4 * sampleRate)
  const step = Math.round(0.1 * sampleRate)
  const squares: number[] = []
  const length = Math.max(weighted.length, block)
  for (let start = 0; start + block <= length; start += step) {
    let sum = 0
    for (let i = start; i < Math.min(start + block, weighted.length); i++) sum += weighted[i] ** 2
    squares.push(sum / block)
  }
  const lufs = (meanSquare: number) => -0.691 + 10 * Math.log10(meanSquare)
  const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length
  const audible = squares.filter(z => lufs(z) > -70)
  if (audible.length === 0) return Number.NEGATIVE_INFINITY
  const gate = lufs(mean(audible)) - 10
  return lufs(mean(audible.filter(z => lufs(z) > gate)))
}

/** The loudest sample, in dB below full scale. */
export function peakDbfs(samples: ArrayLike<number>): number {
  let peak = 0
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]))
  return 20 * Math.log10(peak)
}

type Coefficients = { b: [number, number, number]; a: [number, number] }

/** BS.1770's first stage, a +4 dB shelf above about 1.5 kHz: the head. */
function highShelf(rate: number): Coefficients {
  const gain = 10 ** (4 / 40)
  const w = (2 * Math.PI * 1500) / rate
  const alpha = Math.sin(w) / (2 * Math.SQRT1_2)
  const c = Math.cos(w)
  const root = 2 * Math.sqrt(gain) * alpha
  const a0 = gain + 1 - (gain - 1) * c + root
  return {
    b: [
      (gain * (gain + 1 + (gain - 1) * c + root)) / a0,
      (-2 * gain * (gain - 1 + (gain + 1) * c)) / a0,
      (gain * (gain + 1 + (gain - 1) * c - root)) / a0
    ],
    a: [(2 * (gain - 1 - (gain + 1) * c)) / a0, (gain + 1 - (gain - 1) * c - root) / a0]
  }
}

/** BS.1770's second stage, a high-pass at about 38 Hz. */
function highPass(rate: number): Coefficients {
  const w = (2 * Math.PI * 38) / rate
  const alpha = Math.sin(w) / (2 * 0.5)
  const c = Math.cos(w)
  const a0 = 1 + alpha
  return {
    b: [(1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0],
    a: [(-2 * c) / a0, (1 - alpha) / a0]
  }
}

function biquad(x: ArrayLike<number>, { b, a }: Coefficients): Float64Array {
  const y = new Float64Array(x.length)
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < x.length; i++) {
    const out = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2
    x2 = x1
    x1 = x[i]
    y2 = y1
    y1 = out
    y[i] = out
  }
  return y
}
