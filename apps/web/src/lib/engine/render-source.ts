import { contour } from '@/lib/analysis/recording-pitch'
import { ANALYSIS_SAMPLE_RATE, resampleToAnalysisRate } from '@/lib/analysis/resample'
import type { Analysis } from '@/lib/recordings'
import type { PcmAudio } from '@/lib/wav'
import type { RenderSource } from './renderer'

/**
 * What the renderer needs from a Melodic Recording: its gesture, cut from the Recording's audio at
 * the stored analysis's bounds, and the gesture's pitch contour. The contour isn't stored with the
 * analysis, so this recomputes it with the same pYIN pass Recording Analysis uses. Port of
 * `RecordingAnalyzer.renderSource` in `Renderer.swift`.
 *
 * `audio` is the whole Recording at its own sample rate, the input `analyzeRecording` took.
 * Synchronous and CPU-bound: run it in a Web Worker.
 */
export function renderSource(audio: PcmAudio, analysis: Analysis): RenderSource {
  if (analysis.recordingPitchMidi === null) {
    throw new Error('Only Melodic Recordings can play notes')
  }
  const y = resampleToAnalysisRate(audio.samples, audio.sampleRate)
  const sr = ANALYSIS_SAMPLE_RATE
  const start = Math.min(y.length, Math.round(analysis.gestureStartSeconds * sr))
  const end = Math.min(y.length, Math.max(start, Math.round(analysis.gestureEndSeconds * sr)))
  const gesture = Float64Array.from(y.subarray(start, end))
  return {
    gesture,
    pitchContourHz: contour(gesture),
    recordingPitchMidi: analysis.recordingPitchMidi
  }
}
