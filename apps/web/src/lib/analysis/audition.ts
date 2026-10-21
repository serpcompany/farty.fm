import { hzToMidi } from './numeric'
import { sharedPyin } from './pyin'
import { npMedian } from './recording-pitch'
import { ANALYSIS_SAMPLE_RATE } from './resample'
import { variableResample } from './variable-resample'

// `audition()` of the reference engine (`Audition.swift`): play the Recording through the real
// render path at its own pitch for a few note lengths and read the pitch back. This is analysis
// only; the rendered notes are measured and thrown away, never played.

/** Note lengths tried, shortest first, in seconds. */
export const NOTE_LENGTHS = [0.12, 0.2, 0.35, 0.6]
/** How far off the read-back pitch may be. */
const TOLERANCE_CENTS = 40

/**
 * The shortest note length (s) that still reads back within 40 cents of `referenceMidi`, or null
 * if none does (the Recording is Noise-like after all). Catches farts whose pitch only settles
 * after the attack.
 */
export function shortestNote(
  audio: Float64Array,
  f0: Float64Array,
  referenceMidi: number
): number | null {
  const seconds = audio.length / ANALYSIS_SAMPLE_RATE
  for (const length of NOTE_LENGTHS) {
    const cents = readBackCents(audio, f0, referenceMidi, length)
    if (cents !== null && cents <= TOLERANCE_CENTS) return length
    if (length >= seconds) break
  }
  return null
}

/**
 * Renders a note of `length` seconds (or the whole gesture if shorter) at the Recording's own
 * pitch and returns how far its median pYIN pitch is from `referenceMidi`, in cents. Null if
 * fewer than 2 frames are voiced.
 */
export function readBackCents(
  audio: Float64Array,
  f0: Float64Array,
  referenceMidi: number,
  length: number
): number | null {
  const sr = ANALYSIS_SAMPLE_RATE
  const n = Math.trunc(Math.min(length, audio.length / sr) * sr)
  const note = variableResample(audio, f0, 1, 1, n, referenceMidi)
  const pyin = sharedPyin().run(note)
  const heard: number[] = []
  for (let i = 0; i < pyin.f0.length; i++) {
    if (pyin.voiced[i] && Number.isFinite(pyin.f0[i])) heard.push(hzToMidi(pyin.f0[i]))
  }
  if (heard.length < 2) return null
  return Math.abs(npMedian(heard) - referenceMidi) * 100
}
