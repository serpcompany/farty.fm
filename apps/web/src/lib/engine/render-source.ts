import { ANALYSIS_SAMPLE_RATE, resampleToAnalysisRate } from '@/lib/analysis/resample'
import { levelDb } from '@/lib/analysis/trimming'
import type { Analysis, RecordingTrim } from '@/lib/recordings'
import type { PcmAudio } from '@/lib/wav'
import type { RenderSource } from './renderer'

/** Sound: a 5 ms level within this of the peak, as the gesture's end (#287). */
const LEAD_IN_DB = 30
/** A quieter gap this long or shorter is kept inside the lead-in. */
const LEAD_IN_GAP_SECONDS = 0.05
/** The longest lead-in: 009's 0.215 s G3 opening, and no more room noise. */
const LEAD_IN_MAX_SECONDS = 0.25

/**
 * What the renderer needs from a Melodic Recording, or a Noise-like one placed on a note by ear
 * (ADR 0015): its gesture, cut from the Recording's audio at the stored analysis's bounds, the
 * whole fart with every burst and only the silence around it trimmed (ADR 0016), and the quiet
 * lead-in before it, which Songs play before the note's beat (#287). With a Trim (`trimOf`, ADR
 * 0019) it is cut at the fart found between the Trim's handles instead, which `trimBounds` found
 * when the Trim was saved, and its lead-in is found between the handles too, as `trimmed()` in
 * the reference finds it: nothing before the start handle plays. Songs play the fart raw (ADR
 * 0012), so nothing else is needed, not even its pitch: which Recordings play is Auto-map's to
 * decide.
 *
 * `audio` is the whole Recording at its own sample rate, the input `analyzeRecording` took. The
 * lead-in is found here, from that audio, so the stored analysis doesn't change.
 * Synchronous: run it in a Web Worker.
 */
export function renderSource(
  audio: PcmAudio,
  analysis: Analysis,
  trim: RecordingTrim | null = null
): RenderSource {
  const y = resampleToAnalysisRate(audio.samples, audio.sampleRate)
  const sr = ANALYSIS_SAMPLE_RATE
  const from = trim?.fart.startSeconds ?? analysis.gestureStartSeconds
  const to = trim?.fart.endSeconds ?? analysis.gestureEndSeconds
  const start = Math.min(y.length, Math.round(from * sr))
  const end = Math.min(y.length, Math.max(start, Math.round(to * sr)))
  return {
    gesture: Float64Array.from(y.subarray(start, end)),
    leadIn: Float64Array.from(
      y.subarray(trim ? trimLeadInStart(y, start, trim) : leadInStart(y, start), start)
    )
  }
}

/**
 * Where a trimmed fart's lead-in begins: `leadInStart` on the part the Trim's handles keep, as
 * `trimBounds` finds the fart there, so it never reaches before the start handle. `start` when
 * the fart isn't between the handles.
 */
function trimLeadInStart(y: Float32Array, start: number, trim: RecordingTrim): number {
  const sr = ANALYSIS_SAMPLE_RATE
  const a = Math.max(0, Math.min(y.length, Math.round(trim.startSeconds * sr)))
  const b = Math.max(a, Math.min(y.length, Math.round(trim.endSeconds * sr)))
  if (start < a || start > b) return start
  return a + leadInStart(y.subarray(a, b), start - a)
}

/**
 * Where the fart's lead-in begins, in samples of the 44.1 kHz audio: `lead_in_start()` of the
 * reference engine (#287), the sound joined to the attack. On the 5 ms RMS envelope the gesture's
 * start comes from, it walks back from the attack's frame (the first within 12 dB of the peak)
 * over every frame within 30 dB of the peak and over quieter gaps of up to 50 ms, and starts 8 ms
 * before the earliest such frame, as the gesture starts 8 ms before the attack. A sound before a
 * longer gap isn't the fart's: on the owner's room-noisy phone takes it's room noise, up to 2 s
 * of it (#295). At most 0.25 s, for a room loud enough to join its noise to the attack. Never
 * after `start`.
 */
export function leadInStart(y: Float32Array, start: number): number {
  const sr = ANALYSIS_SAMPLE_RATE
  const hop = Math.trunc(0.005 * sr)
  const fine = levelDb(y, 2 * hop, hop)
  let peak = Number.NEGATIVE_INFINITY
  for (const v of fine) if (v > peak) peak = v
  const attack = fine.findIndex(v => v >= peak - 12)
  const longestGap = Math.round(LEAD_IN_GAP_SECONDS / 0.005)
  let first = attack
  let below = 0
  for (let i = attack - 1; i >= 0; i--) {
    if (fine[i] >= peak - LEAD_IN_DB) {
      first = i
      below = 0
    } else if (++below > longestGap) {
      break
    }
  }
  return Math.min(
    start,
    Math.max(0, first * hop - Math.trunc(0.008 * sr), start - Math.trunc(LEAD_IN_MAX_SECONDS * sr))
  )
}
