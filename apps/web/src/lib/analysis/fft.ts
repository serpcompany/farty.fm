export class Autocorrelation {
  private readonly half: number
  private readonly fft: ComplexFFT
  private readonly re: Float64Array
  private readonly im: Float64Array
  private readonly power: Float64Array
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

  compute(x: Float64Array, start: number, length: number, out: Float64Array): void {
    this.packEvenOddSamples(x, start, length)
    this.fft.transform(this.re, this.im, false)
    this.powerSpectrumFromPacked()
    this.packPowerSpectrumForInverse()
    this.fft.transform(this.re, this.im, true)
    this.unpackLags(out)
  }

  private packEvenOddSamples(x: Float64Array, start: number, length: number): void {
    const re = this.re
    const im = this.im
    re.fill(0)
    im.fill(0)
    for (let i = 0; i < length; i++) {
      if (i % 2 === 0) re[i >> 1] = x[start + i]
      else im[i >> 1] = x[start + i]
    }
  }

  private powerSpectrumFromPacked(): void {
    const half = this.half
    const re = this.re
    const im = this.im
    for (let k = 0; k <= half; k++) {
      const a = k % half
      const b = (half - k) % half
      const zr = re[a]
      const zi = im[a]
      const conjugateRe = re[b]
      const conjugateIm = -im[b]
      const evenRe = (zr + conjugateRe) / 2
      const evenIm = (zi + conjugateIm) / 2
      const oddRe = (zi - conjugateIm) / 2
      const oddIm = -(zr - conjugateRe) / 2
      const twiddleRe = k < half ? this.splitCos[k] : -1
      const twiddleIm = k < half ? this.splitSin[k] : 0
      const xr = evenRe + twiddleRe * oddRe - twiddleIm * oddIm
      const xi = evenIm + twiddleRe * oddIm + twiddleIm * oddRe
      this.power[k] = xr * xr + xi * xi
    }
  }

  private packPowerSpectrumForInverse(): void {
    const half = this.half
    const power = this.power
    for (let k = 0; k < half; k++) {
      const p = power[k]
      const q = power[half - k]
      const even = (p + q) / 2
      const odd = (p - q) / 2
      this.re[k] = even + odd * this.splitSin[k]
      this.im[k] = odd * this.splitCos[k]
    }
  }

  private unpackLags(out: Float64Array): void {
    for (let lag = 0; lag < out.length; lag++) {
      out[lag] = lag % 2 === 0 ? this.re[lag >> 1] : this.im[lag >> 1]
    }
  }
}

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
