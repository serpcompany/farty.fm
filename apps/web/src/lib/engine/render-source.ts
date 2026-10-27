import { ANALYSIS_SAMPLE_RATE, resampleToAnalysisRate } from '@/lib/analysis/resample'
import type { Analysis } from '@/lib/recordings'
import type { PcmAudio } from '@/lib/wav'
import type { RenderSource } from './renderer'

/**
 * What the renderer needs from a Melodic Recording: its gesture, cut from the Recording's audio at
 * the stored analysis's bounds. Songs play the gesture raw (ADR 0012), so nothing else is needed.
 *
 * `audio` is the whole Recording at its own sample rate, the input `analyzeRecording` took.
 * Synchronous: run it in a Web Worker.
 */
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
