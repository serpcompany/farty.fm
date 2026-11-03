export function frameRms(
  y: Float32Array | Float64Array,
  frameLength: number,
  hop: number
): Float64Array {
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
