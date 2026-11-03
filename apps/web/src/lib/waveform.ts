/**
 * Peak loudness of `count` equal slices of the audio, scaled so the loudest is 1, as the iPhone
 * app's `Waveform.levels`. Flat bars when there's too little audio or it's silent. `samples` may be
 * at any scale, such as 16-bit PCM's, since the peaks are scaled to the loudest. With `step`, each
 * slice's peak is of every `step`th sample, for a long take's bars at a fraction of the work.
 */
export function waveformLevels(samples: ArrayLike<number>, count: number, step = 1): number[] {
  const flat = Array<number>(count).fill(0.05)
  if (count <= 0 || samples.length < count) return flat
  const slice = Math.floor(samples.length / count)
  const stride = Math.max(1, Math.floor(step))
  const peaks = Array.from({ length: count }, (_, bar) => {
    let peak = 0
    for (let i = bar * slice; i < (bar + 1) * slice; i += stride)
      peak = Math.max(peak, Math.abs(samples[i]))
    return peak
  })
  const loudest = Math.max(...peaks)
  if (loudest <= 0) return flat
  return peaks.map(peak => Math.max(peak / loudest, 0.05))
}
