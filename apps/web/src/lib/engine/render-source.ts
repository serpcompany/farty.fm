import { ANALYSIS_SAMPLE_RATE, resampleToAnalysisRate } from '@/lib/analysis/resample'
import type { Analysis } from '@/lib/recordings'
import type { PcmAudio } from '@/lib/wav'
import type { RenderSource } from './renderer'

/**
 * What the renderer needs from a Melodic Recording, or a Noise-like one placed on a note by ear
 * (ADR 0015): its gesture, cut from the Recording's audio at the stored analysis's bounds, the
 * whole fart with every burst and only the silence around it trimmed (ADR 0016). Songs play the
 * gesture raw (ADR 0012), so nothing else is needed, not even its pitch: which Recordings play is
 * Auto-map's to decide.
 *
 * `audio` is the whole Recording at its own sample rate, the input `analyzeRecording` took.
 * Synchronous: run it in a Web Worker.
 */
export function renderSource(audio: PcmAudio, analysis: Analysis): RenderSource {
  const y = resampleToAnalysisRate(audio.samples, audio.sampleRate)
  const sr = ANALYSIS_SAMPLE_RATE
  const start = Math.min(y.length, Math.round(analysis.gestureStartSeconds * sr))
  const end = Math.min(y.length, Math.max(start, Math.round(analysis.gestureEndSeconds * sr)))
  return { gesture: Float64Array.from(y.subarray(start, end)) }
}
