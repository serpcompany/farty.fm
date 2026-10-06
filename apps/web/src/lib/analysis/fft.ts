/**
 * Autocorrelation of real frames by FFT: `librosa.autocorrelate(frame)`, which zero-pads to
 * `n` samples, takes the inverse FFT of the power spectrum, and keeps the first lags. pYIN calls
 * it once per frame with `n = 4096` (`scipy.fft.next_fast_len(2 * 2048 - 1)`).
 *
 * Both real transforms of size `n` run as complex transforms of size `n / 2` (even samples in
 * the real part, odd in the imaginary part), all in double precision.
 */
export class Autocorrelation {
  private readonly half: number
  private readonly fft: ComplexFFT
  private readonly re: Float64Array
  private readonly im: Float64Array
  private readonly power: Float64Array
  /** e^(−2πik/n) for k < n/2: the split between the even and odd halves. */
  private readonly splitCos: Float64Array
  private readonly splitSin: Float64Array

  constructor(readonly n: number) {
    this.half = n / 2
    this.fft = new ComplexFFT(this.half)
    this.re = new Float64Array(this.half)
    this.im = new Float64Array(this.half)
    this.power = new Float64Array(this.half + 1)
    this.splitCos = new Float64Array(this.half)
    this.splitSin = new Float64Array(this.half)
    for (let k = 0; k < this.half; k++) {
      this.splitCos[k] = Math.cos((2 * Math.PI * k) / n)
      this.splitSin[k] = -Math.sin((2 * Math.PI * k) / n)
    }
  }

  /** Writes lags `0 ..< out.length` of the autocorrelation of `x[start ..< start + length]`. */
  compute(x: Float64Array, start: number, length: number, out: Float64Array): void {
    const half = this.half
    const re = this.re
    const im = this.im
    const power = this.power
    const splitCos = this.splitCos
    const splitSin = this.splitSin
    // Forward real FFT: z[m] = x[2m] + i x[2m+1], zero-padded.
    re.fill(0)
    im.fill(0)
    for (let i = 0; i < length; i++) {
      if (i % 2 === 0) re[i >> 1] = x[start + i]
      else im[i >> 1] = x[start + i]
    }
    this.fft.transform(re, im, false)
    // X[k] = E[k] + e^(−2πik/n) O[k], with E and O recovered from Z[k] and conj(Z[half − k]).
    for (let k = 0; k <= half; k++) {
      const a = k % half
      const b = (half - k) % half
      const zr = re[a]
      const zi = im[a]
      const cr = re[b]
      const ci = -im[b]
      const er = (zr + cr) / 2
      const ei = (zi + ci) / 2
      // O = (Z − conj(Z')) / 2i
      const or = (zi - ci) / 2
      const oi = -(zr - cr) / 2
      const wr = k < half ? splitCos[k] : -1
      const wi = k < half ? splitSin[k] : 0
      const xr = er + wr * or - wi * oi
      const xi = ei + wr * oi + wi * or
      power[k] = xr * xr + xi * xi
    }
    // Inverse real FFT of the (real, even) power spectrum P: with Y[k] = P[k] and
    // Y[k + half] = P[half − k], E[k] = (Y[k] + Y[k + half]) / 2 and
    // O[k] = (Y[k] − Y[k + half]) / 2 · e^(+2πik/n); z = IFFT(E + iO) holds the even lags in
    // its real part and the odd lags in its imaginary part.
    for (let k = 0; k < half; k++) {
      const p = power[k]
      const q = power[half - k]
      const e = (p + q) / 2
      const d = (p - q) / 2
      // i · O = i · d · (cos + i sin) = −d sin + i d cos, with sin = −splitSin.
      re[k] = e + d * splitSin[k]
      im[k] = d * splitCos[k]
    }
    this.fft.transform(re, im, true)
    for (let lag = 0; lag < out.length; lag++) {
      out[lag] = lag % 2 === 0 ? re[lag >> 1] : im[lag >> 1]
    }
  }
}

/** In-place iterative radix-2 complex FFT. The inverse includes the 1/n scaling. */
class ComplexFFT {
  private readonly reverse: Uint32Array
  private readonly cos: Float64Array
  private readonly sin: Float64Array

  constructor(readonly n: number) {
    if (n < 2 || (n & (n - 1)) !== 0) throw new RangeError(`FFT size ${n} is not a power of 2`)
    const bits = Math.log2(n)
    this.reverse = new Uint32Array(n)
    for (let i = 0; i < n; i++) {
      let r = 0
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b)
      this.reverse[i] = r
    }
    this.cos = new Float64Array(n / 2)
    this.sin = new Float64Array(n / 2)
    for (let k = 0; k < n / 2; k++) {
      this.cos[k] = Math.cos((2 * Math.PI * k) / n)
      this.sin[k] = Math.sin((2 * Math.PI * k) / n)
    }
  }

  transform(re: Float64Array, im: Float64Array, inverse: boolean): void {
    const n = this.n
    const reverse = this.reverse
    const cos = this.cos
    const sin = this.sin
    for (let i = 0; i < n; i++) {
      const j = reverse[i]
      if (j > i) {
        const tr = re[i]
        re[i] = re[j]
        re[j] = tr
        const ti = im[i]
        im[i] = im[j]
        im[j] = ti
      }
    }
    const sign = inverse ? 1 : -1
    for (let size = 2; size <= n; size *= 2) {
      const halfSize = size / 2
      const step = n / size
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < halfSize; k++) {
          const wr = cos[k * step]
          const wi = sign * sin[k * step]
          const a = start + k
          const b = a + halfSize
          const xr = re[b] * wr - im[b] * wi
          const xi = re[b] * wi + im[b] * wr
          re[b] = re[a] - xr
          im[b] = im[a] - xi
          re[a] += xr
          im[a] += xi
        }
      }
    }
    if (inverse) {
      for (let i = 0; i < n; i++) {
        re[i] /= n
        im[i] /= n
      }
    }
  }
}
