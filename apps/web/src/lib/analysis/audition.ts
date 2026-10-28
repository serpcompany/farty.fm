import { hzToMidi } from './numeric'
import { Pyin, sharedPyin } from './pyin'
import { npMedian } from './recording-pitch'
import { ANALYSIS_SAMPLE_RATE } from './resample'
import { variableResample } from './variable-resample'

export const NOTE_LENGTHS = [0.12, 0.2, 0.35, 0.6]
const READ_BACK_TOLERANCE_CENTS = 40
const SETTLE_CENTS = 50
const FEWEST_HEARD_FRAMES = 2
const SETTLE_RUN_FRAMES = 9

export function shortestNote(
  audio: Float64Array,
  f0: Float64Array,
  referenceMidi: number
): number | null {
  const seconds = audio.length / ANALYSIS_SAMPLE_RATE
  for (const length of NOTE_LENGTHS) {
    const cents = readBackCents(audio, f0, referenceMidi, length)
    if (cents !== null && cents <= READ_BACK_TOLERANCE_CENTS) return length
    if (length >= seconds) break
  }
  return null
}

export function readBackCents(
  audio: Float64Array,
  f0: Float64Array,
  referenceMidi: number,
  length: number
): number | null {
  const sr = ANALYSIS_SAMPLE_RATE
  const n = Math.trunc(Math.min(length, audio.length / sr) * sr)
  const note = variableResample(audio, f0, n, referenceMidi)
  const pyin = sharedPyin().run(note)
  const heard: number[] = []
  for (let i = 0; i < pyin.f0.length; i++) {
    if (pyin.voiced[i] && Number.isFinite(pyin.f0[i])) heard.push(hzToMidi(pyin.f0[i]))
  }
  if (heard.length < FEWEST_HEARD_FRAMES) return null
  return Math.abs(npMedian(heard) - referenceMidi) * 100
}

export function settleTime(audio: Float64Array, f0: Float64Array, referenceMidi: number): number {
  const sr = ANALYSIS_SAMPLE_RATE
  const seconds = audio.length / sr
  const played = variableResample(audio, f0, audio.length, referenceMidi)
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
