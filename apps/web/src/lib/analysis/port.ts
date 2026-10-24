import type { Analysis } from '@/lib/recordings'
import { analyzeRecording, type RecordingAnalysis } from './recording-analysis'

/** What the app keeps of Recording Analysis, as the iPhone app's `SavedAnalysis`. */
export function toAnalysis(result: RecordingAnalysis): Analysis {
  return {
    gestureStartSeconds: result.gestureStartSeconds,
    gestureEndSeconds: result.gestureEndSeconds,
    cutAtReattack: result.cutAtReattack,
    pitchEstimateMidi: result.pitchEstimateMidi,
    pitchConfidence: result.pitchConfidence,
    recordingPitchMidi: result.recordingPitchMidi,
    shortestNoteSeconds: result.shortestNoteSeconds,
    settleSeconds: result.settleSeconds,
    version: result.version
  }
}

export function analyzeToAnalysis(samples: Float32Array, sampleRate: number): Analysis {
  return toAnalysis(analyzeRecording(samples, sampleRate))
}
