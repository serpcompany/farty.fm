import { hzToMidi } from './numeric'
import { Pyin, sharedPyin } from './pyin'
import { npMedian } from './recording-pitch'
import { ANALYSIS_SAMPLE_RATE } from './resample'
import { variableResample } from './variable-resample'

// `audition()` and `settle_time()` of the reference engine (`Audition.swift` has only the first):
// play the Recording through the real render path at its own pitch and read the pitch back. This
// is analysis only; the rendered notes are measured and thrown away, never played.

/** Note lengths tried, shortest first, in seconds. */
export const NOTE_LENGTHS = [0.12, 0.2, 0.35, 0.6]
/** How far off the read-back pitch may be. */
const TOLERANCE_CENTS = 40
/** On pitch, for the settle time: within this many cents, as `evaluate.py` counts a note. */
const SETTLE_CENTS = 50
/** ... for this many pYIN frames in a row (9 hops of 256 samples: 52 ms). */
const SETTLE_RUN_FRAMES = 9

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

/**
 * Seconds from the gesture start until the Recording, played whole at its own pitch, is on pitch
 * and stays there (#116): the first pYIN frame (centered on frame × 256 samples) that starts 9
 * voiced frames in a row within 50 cents of `referenceMidi`, or the gesture's length if none does.
 * Glides and scoops the renderer's pitch-following can't straighten show up here.
 */
export function settleTime(audio: Float64Array, f0: Float64Array, referenceMidi: number): number {
  const sr = ANALYSIS_SAMPLE_RATE
  const seconds = audio.length / sr
  const played = variableResample(audio, f0, 1, 1, audio.length, referenceMidi)
  const pyin = sharedPyin().run(played)
  let run = 0
  for (let i = 0; i < pyin.f0.length; i++) {
    const f = pyin.f0[i]
    const on =
      pyin.voiced[i] !== 0 &&
      Number.isFinite(f) &&
      Math.abs((hzToMidi(f) - referenceMidi) * 100) <= SETTLE_CENTS
    run = on ? run + 1 : 0
    if (run === SETTLE_RUN_FRAMES) {
      return Math.min(seconds, ((i - SETTLE_RUN_FRAMES + 1) * Pyin.hopLength) / sr)
    }
  }
  return seconds
}
