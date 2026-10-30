import { ANALYSIS_VERSION } from './analysis/version'

/** A Recording: one saved fart clip (see `CONTEXT.md`), as the web app keeps it. */

/** What Recording Analysis found in a Recording, as the iPhone app's `SavedAnalysis`. */
export type Analysis = {
  /**
   * Where the fart starts and ends in the file, in seconds: from just before its attack to where
   * it fades out, never cut at a second burst. Songs play this much from the note's beat (ADR
   * 0016), and a quieter lead-in before it in the rest before the note (`renderSource`, #287).
   */
  gestureStartSeconds: number
  gestureEndSeconds: number
  /**
   * The take holds a second burst, so the pitch was read from the first burst only. Before
   * version 4 (ADR 0016), Songs also played only the first.
   */
  cutAtReattack: boolean
  /** The pitch estimate before audition, as a MIDI note number, and its confidence (0…1). */
  pitchEstimateMidi: number | null
  pitchConfidence: number
  /** The Recording Pitch as a fractional MIDI note number; null for a Noise-like Recording. */
  recordingPitchMidi: number | null
  /** The shortest note the Recording holds on pitch, in seconds; null when Noise-like. */
  shortestNoteSeconds: number | null
  /**
   * When the Recording settles on its pitch, in seconds from the gesture start; null when
   * Noise-like. Absent from an analysis stored before #116.
   */
  settleSeconds?: number | null
  /** The Recording Analysis version that made it (`ANALYSIS_VERSION`); absent before #208. */
  version?: number
}

/** Saving never waits for analysis (ADR 0002), so a Recording can be saved but not analyzed. */
export type AnalysisState =
  | { state: 'analyzing' }
  | { state: 'notAnalyzed' }
  | { state: 'analyzed'; analysis: Analysis }

export type Recording = {
  id: string
  /** Recordings are named "Recording 1, 2, …". */
  number: number
  createdAt: number
  /** Length of the whole file, in seconds. */
  seconds: number
  sampleRate: number
  /** Loudness bars for the waveform, each 0…1. */
  waveform: number[]
  analysis: AnalysisState
  /**
   * The Placed Pitch: the note the user placed this Recording on by ear, as a whole MIDI note
   * number, while it is Noise-like (ADR 0015). Null or absent when it's left out, the default.
   * Kept apart from `analysis`, so re-analysis never loses it, and ignored while the Recording is
   * Melodic (`placedPitch`). Where Songs use the fart, never how it sounds: it plays raw.
   */
  placedPitch?: number | null
}

/** The notes a Noise-like Recording can be placed on: C2 to B4 (ADR 0015). */
export const LOWEST_PLACED_PITCH = 36
export const HIGHEST_PLACED_PITCH = 71

/** Whether `value` is a note a Recording can be placed on. */
export function isPlaceablePitch(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= LOWEST_PLACED_PITCH &&
    (value as number) <= HIGHEST_PLACED_PITCH
  )
}

export function recordingName(recording: Pick<Recording, 'number'>): string {
  return `Recording ${recording.number}`
}

/** The Recording Pitch, when the Recording has been analyzed as Melodic. */
export function recordingPitch(recording: Recording): number | null {
  return recording.analysis.state === 'analyzed'
    ? recording.analysis.analysis.recordingPitchMidi
    : null
}

/** Whether the Recording has been analyzed as Noise-like. */
export function isNoiseLike(recording: Recording): boolean {
  return (
    recording.analysis.state === 'analyzed' &&
    recording.analysis.analysis.recordingPitchMidi === null
  )
}

/**
 * The Placed Pitch, when the Recording is analyzed as Noise-like and the user placed it on a note;
 * otherwise null. A Recording that re-analysis finds Melodic uses its Recording Pitch instead.
 */
export function placedPitch(recording: Recording): number | null {
  return isNoiseLike(recording) && isPlaceablePitch(recording.placedPitch)
    ? recording.placedPitch
    : null
}

/**
 * The note Songs use the Recording for: its Recording Pitch when Melodic, or its Placed Pitch when
 * Noise-like and placed; null when it plays no notes.
 */
export function songPitch(recording: Recording): number | null {
  return recordingPitch(recording) ?? placedPitch(recording)
}

/**
 * Whether a Recording's stored analysis came from an older Recording Analysis, Melodic or not, so
 * `upgradeAnalyses` should run the current one on its audio.
 */
export function needsReanalysis(recording: Recording): boolean {
  return (
    recording.analysis.state === 'analyzed' &&
    (recording.analysis.analysis.version ?? 0) < ANALYSIS_VERSION
  )
}

/** A length the way rows and Review show it: "1.1 s". */
export function formattedLength(seconds: number): string {
  return `${seconds.toFixed(1)} s`
}

/** Recording stops by itself after this long, as on the iPhone. */
export const maximumTakeSeconds = 30

/**
 * A take's loudest 50 ms must reach this level… With the browser's voice processing off, a take
 * is the microphone's raw level, so this is low: every fart in the Fixture Library whose loudest
 * sample reaches -50 dBFS passes (#279). Below it is near-silence, which `atFullLevel` would only
 * turn into loud hiss.
 */
const quietestFartDb = -70
/** …and stand this far above the take's own room (its 10th-percentile 50 ms level). */
const minimumContrastDb = 4

/**
 * Whether a take holds a sound worth reviewing, judged from the raw audio, before `atFullLevel`:
 * its loudest 50 ms level against an absolute floor and against the take's own room. Silence,
 * white noise and room noise fail at any level. A low rumble passes down to the -70 dBFS floor: a
 * known false accept, which analysis finds no steady note in. The iPhone app and `tools/melody-lab/` have no such gate:
 * the iPhone app rejects takes shorter than 0.5 s, and the reference never rejects. A take shorter
 * than one 50 ms window fails.
 */
export function heardSomething(samples: Float32Array, sampleRate: number): boolean {
  const level = levelContrast(samples, sampleRate)
  return level !== null && level.peakDb >= quietestFartDb && level.contrastDb >= minimumContrastDb
}

/**
 * The peak and floor (10th percentile) of a take's 50 ms RMS level every 5 ms, in dBFS, and the
 * contrast between them. Only whole windows count, so the take's edges don't read as quiet room.
 * Null when the take is shorter than one window.
 */
export function levelContrast(
  samples: Float32Array,
  sampleRate: number
): { peakDb: number; floorDb: number; contrastDb: number } | null {
  const hop = Math.max(1, Math.trunc(0.005 * sampleRate))
  const frame = 10 * hop
  if (samples.length < frame) return null
  // Running sums of squares, so each window costs two lookups.
  const energy = new Float64Array(samples.length + 1)
  for (let i = 0; i < samples.length; i++) energy[i + 1] = energy[i] + samples[i] * samples[i]
  const levels: number[] = []
  for (let start = 0; start + frame <= samples.length; start += hop) {
    const meanSquare = Math.max(0, energy[start + frame] - energy[start]) / frame
    levels.push(20 * Math.log10(Math.sqrt(meanSquare) + 1e-9))
  }
  levels.sort((a, b) => a - b)
  const peakDb = levels[levels.length - 1]
  const floorDb = levels[Math.floor(levels.length * 0.1)]
  return { peakDb, floorDb, contrastDb: peakDb - floorDb }
}

/** The loudest sample of a take at full level: about -1 dBFS, as a rendered Song peaks. */
const fullLevelPeak = 0.89

/**
 * A heard take turned up with one gain, so its loudest sample reaches `fullLevelPeak`. Review and
 * the Recordings tab play the file as it is, so a raw take peaking at -40 dBFS would replay 39 dB
 * quieter than a Song (#279). Only gain (ADR 0004), in float before the 16-bit save (ADR 0007):
 * never turned down, and silence stays silence.
 * Recording Analysis gives the same results on the Fixture Library either way, and a Song sets
 * each note's level itself.
 */
export function atFullLevel(samples: Float32Array): Float32Array {
  let peak = 0
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample))
  if (!(peak > 0) || peak >= fullLevelPeak) return samples
  const gain = fullLevelPeak / peak
  return samples.map(sample => sample * gain)
}
