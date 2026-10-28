import { ANALYSIS_SAMPLE_RATE, resampleToAnalysisRate } from '@/lib/analysis/resample'
import type { Analysis } from '@/lib/recordings'
import type { PcmAudio } from '@/lib/wav'
import type { RenderSource } from './renderer'

export function renderSource(audio: PcmAudio, analysis: Analysis): RenderSource {
  if (analysis.recordingPitchMidi === null) {
    throw new Error('Only Melodic Recordings can play notes')
  }
  const y = resampleToAnalysisRate(audio.samples, audio.sampleRate)
  const sr = ANALYSIS_SAMPLE_RATE
  const start = Math.min(y.length, Math.round(analysis.gestureStartSeconds * sr))
  const end = Math.min(y.length, Math.max(start, Math.round(analysis.gestureEndSeconds * sr)))
  return { gesture: Float64Array.from(y.subarray(start, end)) }
}
