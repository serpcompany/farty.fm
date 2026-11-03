import { resampleToAnalysisRate } from '@/lib/analysis/resample'
import { padSound } from '@/lib/pads'
import type { Performance } from '@/lib/performance'
import type { PcmAudio } from '@/lib/wav'
import { RENDER_SAMPLE_RATE } from './renderer'

export interface PerformanceRecording {
  id: string
  audio: PcmAudio
}

export interface RenderedPerformance {
  samples: Float32Array
  sampleRate: number
  onsets: number[]
  gain: number
}

const FULL_SCALE = 0x7fff / 0x8000

export function tapSound(audio: PcmAudio): Float32Array {
  return padSound([resampleToAnalysisRate(audio.samples, audio.sampleRate)], RENDER_SAMPLE_RATE)[0]
}

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
