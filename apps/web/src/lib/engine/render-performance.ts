import { resampleToAnalysisRate } from '@/lib/analysis/resample'
import { padSound } from '@/lib/pads'
import type { Performance } from '@/lib/performance'
import type { PcmAudio } from '@/lib/wav'
import { RENDER_SAMPLE_RATE } from './renderer'

// A Sound Pad Performance as audio (#278, ADR 0017): each tap plays its Recording as a Pad plays
// it, raw from its start, and the taps mix. Fart-only (ADR 0004, ADR 0012): the one resampling is
// to the render's rate, and the rest is the Pad's trim, fades and gain, and the mix.

/** A Recording a Performance plays: its whole audio at its own rate, as the app stores it. */
export interface PerformanceRecording {
  id: string
  audio: PcmAudio
}

/** A Performance as audio. */
export interface RenderedPerformance {
  /** Mono, from the first tap to the end of the last fart. */
  samples: Float32Array
  sampleRate: number
  /** Where each tap's fart starts, in samples, in the Performance's order. */
  onsets: number[]
  /**
   * The one gain on the whole mix: 1, unless farts played together would pass full scale, which
   * the WAV can't hold. Then it's what puts the mix's peak at full scale, rather than clip.
   */
  gain: number
}

/** The loudest a 16-bit WAV holds without clipping: `encodeWav` writes 1.0 as 32768. */
const FULL_SCALE = 0x7fff / 0x8000

/**
 * What a tap of this Recording plays: its audio at the render's rate (44.1 kHz, the only
 * resampling), as a Pad plays it (`padSound`): its sounding span, faded in and out, at the Pads'
 * one level, peaking at `PAD_PEAK`.
 */
export function tapSound(audio: PcmAudio): Float32Array {
  return padSound([resampleToAnalysisRate(audio.samples, audio.sampleRate)], RENDER_SAMPLE_RATE)[0]
}

/**
 * Plays `performance` on `recordings`, which hold every Recording it names: each tap's sound
 * (`tapSound`) starts at the tap's time, to the nearest sample at 44.1 kHz, and they add up.
 * Nothing loops, stretches or limits. Throws if a Recording is missing.
 *
 * Synchronous and CPU-bound: run it in the render worker.
 */
export function renderPerformance(
  performance: Performance,
  recordings: readonly PerformanceRecording[]
): RenderedPerformance {
  const sounds = performance.recordings.map(id => {
    const recording = recordings.find(r => r.id === id)
    if (!recording) throw new Error(`No audio for Recording ${id}`)
    return tapSound(recording.audio)
  })
  const onsets = performance.taps.map(([at]) => Math.round(at * RENDER_SAMPLE_RATE))
  const length = performance.taps.reduce(
    (end, [, index], i) => Math.max(end, onsets[i] + sounds[index].length),
    0
  )
  const samples = new Float32Array(length)
  performance.taps.forEach(([, index], i) => {
    const sound = sounds[index]
    const start = onsets[i]
    for (let k = 0; k < sound.length; k++) samples[start + k] += sound[k]
  })
  let peak = 0
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample))
  const gain = peak > FULL_SCALE ? FULL_SCALE / peak : 1
  if (gain !== 1) for (let i = 0; i < samples.length; i++) samples[i] *= gain
  return { samples, sampleRate: RENDER_SAMPLE_RATE, onsets, gain }
}
