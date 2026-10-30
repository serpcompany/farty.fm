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
  /**
   * Start of the fart, in samples of the 44.1 kHz audio: just before its attack, so a quieter
   * lead-in is trimmed too (#287). Songs play the fart from here to `gestureEndSample`, never cut
   * at a second burst (ADR 0016).
   */
  gestureStartSample: number
  /** End of the fart (exclusive), where it fades out, in samples of the 44.1 kHz audio. */
  gestureEndSample: number
  /** The same in seconds from the start of the Recording. */
  gestureStartSeconds: number
  gestureEndSeconds: number
  /**
   * End of its first burst (exclusive), in samples of the 44.1 kHz audio: the gesture's end unless
   * the take holds a second burst. The pitch, audition and settle time read only up to here.
   */
  pitchEndSample: number
  pitchEndSeconds: number
  /**
   * The take holds a second burst, so the pitch is read from the first burst only. Songs play
   * every burst since ADR 0016 (version 4); before, they played only the first.
   */
  cutAtReattack: boolean
  /**
   * The first burst's smoothed pitch contour in MIDI, one value per 256-sample hop at 44.1 kHz,
   * null when unvoiced.
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
   * the gesture start (`settle_time()`), over the first burst. Null for Noise-like Recordings.
   */
  settleSeconds: number | null
  /** RMS level of the fart, every burst, in dB. */
  rmsDb: number
}

/**
 * The whole reference analysis of a mono Recording at any sample rate: resample to 44.1 kHz,
 * find the fart and its first burst, track the first burst's pitch, estimate the Recording Pitch,
 * audition it and measure when it settles on pitch.
 *
 * Pure and synchronous: no DOM, Web Audio or Node APIs, so it runs the same in a Web Worker and
 * in tests. CPU-bound; call it off the main thread.
 */
export function analyzeRecording(samples: Float32Array, sampleRate: number): RecordingAnalysis {
  const y = resampleToAnalysisRate(samples, sampleRate)
  const gesture = noteSegment(y)
  // The pitch is read from the first burst alone, so a second one can't blur it (ADR 0016).
  const body = Float64Array.from(y.subarray(gesture.start, gesture.pitchEnd))
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
    pitchEndSample: gesture.pitchEnd,
    pitchEndSeconds: gesture.pitchEnd / sr,
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
    rmsDb: rmsDb(y.subarray(gesture.start, gesture.end))
  }
}

/** `20 * log10(sqrt(mean(fart ** 2)) + 1e-9)`, summed in double precision. */
function rmsDb(fart: Float32Array): number {
  let sum = 0
  for (const s of fart) sum += s * s
  return 20 * Math.log10(Math.sqrt(fart.length > 0 ? sum / fart.length : 0) + 1e-9)
}
