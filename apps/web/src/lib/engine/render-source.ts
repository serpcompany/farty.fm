import { ANALYSIS_SAMPLE_RATE, resampleToAnalysisRate } from '@/lib/analysis/resample'
import { levelDb } from '@/lib/analysis/trimming'
import type { Analysis } from '@/lib/recordings'
import type { PcmAudio } from '@/lib/wav'
import type { RenderSource } from './renderer'

/** The first sound: the first 5 ms level within this of the peak, as the gesture's end (#287). */
const LEAD_IN_DB = 30

/**
 * What the renderer needs from a Melodic Recording, or a Noise-like one placed on a note by ear
 * (ADR 0015): its gesture, cut from the Recording's audio at the stored analysis's bounds, the
 * whole fart with every burst and only the silence around it trimmed (ADR 0016), and the quiet
 * lead-in before it, which Songs play before the note's beat (#287). Songs play the fart raw
 * (ADR 0012), so nothing else is needed, not even its pitch: which Recordings play is Auto-map's
 * to decide.
 *
 * `audio` is the whole Recording at its own sample rate, the input `analyzeRecording` took. The
 * lead-in is found here, from that audio, so the stored analysis doesn't change.
 * Synchronous: run it in a Web Worker.
 */
export function renderSource(audio: PcmAudio, analysis: Analysis): RenderSource {
  const y = resampleToAnalysisRate(audio.samples, audio.sampleRate)
  const sr = ANALYSIS_SAMPLE_RATE
  const start = Math.min(y.length, Math.round(analysis.gestureStartSeconds * sr))
  const end = Math.min(y.length, Math.max(start, Math.round(analysis.gestureEndSeconds * sr)))
  return {
    gesture: Float64Array.from(y.subarray(start, end)),
    leadIn: Float64Array.from(y.subarray(leadInStart(y, start), start))
  }
}

/**
 * Where the fart's first sound begins, in samples of the 44.1 kHz audio: `lead_in_start()` of the
 * reference engine (#287). On the 5 ms RMS envelope the gesture's start comes from, the first
 * frame within 30 dB of the peak, minus 8 ms, as the start is the first within 12 dB minus 8 ms.
 * Only silence comes before it, as only silence comes after the gesture's end; a quiet sound
 * before the attack, and any gap in it, is kept, as every burst after it is (ADR 0016). Never
 * after `start`.
 */
export function leadInStart(y: Float32Array, start: number): number {
  const sr = ANALYSIS_SAMPLE_RATE
  const hop = Math.trunc(0.005 * sr)
  const fine = levelDb(y, 2 * hop, hop)
  let peak = Number.NEGATIVE_INFINITY
  for (const v of fine) if (v > peak) peak = v
  const first = fine.findIndex(v => v >= peak - LEAD_IN_DB)
  return Math.min(start, Math.max(0, first * hop - Math.trunc(0.008 * sr)))
}
