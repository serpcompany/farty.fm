/**
 * Peak loudness of `count` equal slices of the audio, scaled so the loudest is 1, as the iPhone
 * app's `Waveform.levels`. Flat bars when there's too little audio or it's silent.
 */
export function waveformLevels(samples: Float32Array, count: number): number[] {
  const flat = Array<number>(count).fill(0.05)
  if (count <= 0 || samples.length < count) return flat
  const slice = Math.floor(samples.length / count)
  const peaks = Array.from({ length: count }, (_, bar) => {
    let peak = 0
    for (let i = bar * slice; i < (bar + 1) * slice; i++)
      peak = Math.max(peak, Math.abs(samples[i]))
    return peak
  })
  const loudest = Math.max(...peaks)
  if (loudest <= 0) return flat
  return peaks.map(peak => Math.max(peak / loudest, 0.05))
}
