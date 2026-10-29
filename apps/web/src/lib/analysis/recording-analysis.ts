import { settleTime, shortestNote } from './audition'
import { hzToMidi, roundHalfEven } from './numeric'
import { analyzePitch } from './recording-pitch'
import { ANALYSIS_SAMPLE_RATE, resampleToAnalysisRate } from './resample'
import { noteSegment } from './trimming'
import { ANALYSIS_VERSION } from './version'

type NoiseLikeReason = 'no_steady_pitch' | 'failed_audition'

export interface RecordingAnalysis {
  version: number
  gestureStartSample: number
  gestureEndSample: number
  gestureStartSeconds: number
  gestureEndSeconds: number
  cutAtReattack: boolean
  contourMidi: (number | null)[]
  pitchEstimateMidi: number | null
  pitchConfidence: number
  recordingPitchMidi: number | null
  melodic: boolean
  noiseLikeReason: NoiseLikeReason | null
  shortestNoteSeconds: number | null
  settleSeconds: number | null
  rmsDb: number
}

export function analyzeRecording(samples: Float32Array, sampleRate: number): RecordingAnalysis {
  const y = resampleToAnalysisRate(samples, sampleRate)
  const gesture = noteSegment(y)
  const body = Float64Array.from(y.subarray(gesture.start, gesture.endExclusive))
  const pitch = analyzePitch(body)
  const shortest =
    pitch.estimateMidi === null ? null : shortestNote(body, pitch.f0, pitch.estimateMidi)
  const melodic = shortest !== null
  const settle =
    melodic && pitch.estimateMidi !== null ? settleTime(body, pitch.f0, pitch.estimateMidi) : null
  const sr = ANALYSIS_SAMPLE_RATE
  return {
    version: ANALYSIS_VERSION,
    gestureStartSample: gesture.start,
    gestureEndSample: gesture.endExclusive,
    gestureStartSeconds: gesture.start / sr,
    gestureEndSeconds: gesture.endExclusive / sr,
    cutAtReattack: gesture.cutAtReattack,
    contourMidi: Array.from(pitch.f0, f => (Number.isFinite(f) ? hzToMidi(f) : null)),
    pitchEstimateMidi: pitch.estimateMidi,
    pitchConfidence: roundHalfEven(pitch.confidence * 100) / 100,
    recordingPitchMidi: melodic ? pitch.estimateMidi : null,
    melodic,
    noiseLikeReason: melodic
      ? null
      : pitch.estimateMidi === null
        ? 'no_steady_pitch'
        : 'failed_audition',
    shortestNoteSeconds: shortest,
    settleSeconds: settle,
    rmsDb: rmsDb(body)
  }
}

function rmsDb(body: Float64Array): number {
  let sum = 0
  for (const s of body) sum += s * s
  return 20 * Math.log10(Math.sqrt(body.length > 0 ? sum / body.length : 0) + 1e-9)
}
