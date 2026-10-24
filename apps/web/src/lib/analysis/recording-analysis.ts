import { settleTime, shortestNote } from './audition'
import { hzToMidi, roundHalfEven } from './numeric'
import { analyzePitch } from './recording-pitch'
import { ANALYSIS_SAMPLE_RATE, resampleToAnalysisRate } from './resample'
import { noteSegment } from './trimming'
import { ANALYSIS_VERSION } from './version'

export { ANALYSIS_VERSION }

export type NoiseLikeReason = 'no_steady_pitch' | 'failed_audition'

/** What Recording Analysis knows about one Recording (`analyze_recording()` in the reference). */
export interface RecordingAnalysis {
  version: number
  /** Start of the single clean gesture, in samples of the 44.1 kHz audio. */
  gestureStartSample: number
  /** End of the gesture (exclusive), in samples of the 44.1 kHz audio. */
  gestureEndSample: number
  /** The same in seconds from the start of the Recording. */
  gestureStartSeconds: number
  gestureEndSeconds: number
  /**
   * The gesture ends at a second attack: the Recording held more than one fart and only the first
   * is used.
   */
  cutAtReattack: boolean
  /**
   * The gesture's smoothed pitch contour in MIDI, one value per 256-sample hop at 44.1 kHz, null
   * when unvoiced. A renderer gets the reference's `f0` back with `midiToHz`.
   */
  contourMidi: (number | null)[]
  /** The Recording Pitch estimate before audition, in MIDI (60 = middle C). */
  pitchEstimateMidi: number | null
  /** 0 to 1, rounded to 2 decimals. */
  pitchConfidence: number
  /** The Recording Pitch in MIDI. Non-null exactly when the Recording is Melodic. */
  recordingPitchMidi: number | null
  melodic: boolean
  /** Why a Recording is Noise-like: no estimate, or an estimate that never read back on pitch. */
  noiseLikeReason: NoiseLikeReason | null
  /**
   * The shortest note (0.12, 0.2, 0.35 or 0.6 s) the Recording can play and still read back on
   * pitch. Null for Noise-like Recordings.
   */
  shortestNoteSeconds: number | null
  /**
   * When the Recording, played at its own pitch, settles within 50 cents of it, in seconds from
   * the gesture start (`settle_time()`). Null for Noise-like Recordings.
   */
  settleSeconds: number | null
  /** RMS level of the gesture in dB. */
  rmsDb: number
}

/**
 * The whole reference analysis of a mono Recording at any sample rate: resample to 44.1 kHz,
 * cut the single clean gesture, track its pitch, estimate the Recording Pitch, audition it and
 * measure when it settles on pitch.
 *
 * Pure and synchronous: no DOM, Web Audio or Node APIs, so it runs the same in a Web Worker and
 * in tests. CPU-bound; call it off the main thread.
 */
export function analyzeRecording(samples: Float32Array, sampleRate: number): RecordingAnalysis {
  const y = resampleToAnalysisRate(samples, sampleRate)
  const gesture = noteSegment(y)
  const body = Float64Array.from(y.subarray(gesture.start, gesture.end))
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
    gestureEndSample: gesture.end,
    gestureStartSeconds: gesture.start / sr,
    gestureEndSeconds: gesture.end / sr,
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

/** `20 * log10(sqrt(mean(body ** 2)) + 1e-9)`. */
function rmsDb(body: Float64Array): number {
  let sum = 0
  for (const s of body) sum += s * s
  return 20 * Math.log10(Math.sqrt(body.length > 0 ? sum / body.length : 0) + 1e-9)
}
