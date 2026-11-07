import type { Trim } from '@/lib/recordings'

/**
 * Where `seconds` of the audio falls across `view`, a stretch of it drawn as a waveform: 0 at its
 * start, 1 at its end. A replay's playhead is drawn here (`ReplayWaveform`), and a profile row's
 * notes over its waveform (#459), so a note's left edge is where the playhead is as it's heard.
 */
export function timelineAt(seconds: number, view: Trim): number {
  return (seconds - view.startSeconds) / Math.max(1e-6, view.endSeconds - view.startSeconds)
}

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

/**
 * `levels` as `count` thinner bars, each the level where it falls between the two it lies
 * between: the same shape in more bars, so a short fart or a wide row doesn't draw a few fat
 * ones. One level fills them all. Never fewer than it has.
 */
export function finerBars(levels: number[], count: number): number[] {
  if (levels.length === 0 || count <= levels.length) return levels
  if (levels.length === 1) return Array<number>(count).fill(levels[0])
  const last = levels.length - 1
  return Array.from({ length: count }, (_, i) => {
    const at = Math.min(Math.max(((i + 0.5) * levels.length) / count - 0.5, 0), last)
    const below = Math.floor(at)
    const above = Math.min(below + 1, last)
    return levels[below] + (levels[above] - levels[below]) * (at - below)
  })
}
