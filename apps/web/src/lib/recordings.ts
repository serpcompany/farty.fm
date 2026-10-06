/** A Recording: one saved fart clip (see `CONTEXT.md`), as the web app keeps it. */

/** What Recording Analysis found in a Recording, as the iPhone app's `SavedAnalysis`. */
export type Analysis = {
  /** Where the single clean gesture starts and ends in the file, in seconds. */
  gestureStartSeconds: number
  gestureEndSeconds: number
  /** A second fart was cut off, so only the first one is used. */
  cutAtReattack: boolean
  /** The pitch estimate before audition, as a MIDI note number, and its confidence (0…1). */
  pitchEstimateMidi: number | null
  pitchConfidence: number
  /** The Recording Pitch as a fractional MIDI note number; null for a Noise-like Recording. */
  recordingPitchMidi: number | null
  /** The shortest note the Recording holds on pitch, in seconds; null when Noise-like. */
  shortestNoteSeconds: number | null
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

export function firstFartUsed(recording: Recording): boolean {
  return recording.analysis.state === 'analyzed' && recording.analysis.analysis.cutAtReattack
}

/**
 * What replay plays: the fart itself, from where it starts to where it ends (before a second
 * fart, if there is one), or null for the whole file. The file itself is never cut.
 */
export function replaySegment(recording: Recording): { start: number; end: number } | null {
  if (recording.analysis.state !== 'analyzed') return null
  const { gestureStartSeconds: start, gestureEndSeconds } = recording.analysis.analysis
  const end = Math.min(gestureEndSeconds, recording.seconds)
  if (start >= end || (start <= 0 && end >= recording.seconds)) return null
  return { start, end }
}

/** A length the way rows and Review show it: "1.1 s". */
export function formattedLength(seconds: number): string {
  return `${seconds.toFixed(1)} s`
}

/** Takes shorter than this are treated as nothing heard, as on the iPhone. */
export const minimumTakeSeconds = 0.5
/** Recording stops by itself after this long, as on the iPhone. */
export const maximumTakeSeconds = 30
