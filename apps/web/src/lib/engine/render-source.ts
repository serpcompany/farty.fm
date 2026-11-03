import { ANALYSIS_SAMPLE_RATE, resampleToAnalysisRate } from '@/lib/analysis/resample'
import {
  FINE_FRAME_HOPS,
  LEVEL_HOP_SECONDS,
  levelDb,
  ONSET_BELOW_PEAK_DB,
  ONSET_LEAD_SECONDS
} from '@/lib/analysis/trimming'
import type { Analysis, RecordingTrim } from '@/lib/recordings'
import type { PcmAudio } from '@/lib/wav'
import type { RenderSource } from './renderer'

const LEAD_IN_DB = 30
const LEAD_IN_GAP_SECONDS = 0.05
const LEAD_IN_MAX_SECONDS = 0.25

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

function trimLeadInStart(y: Float32Array, start: number, trim: RecordingTrim): number {
  const sr = ANALYSIS_SAMPLE_RATE
  const a = Math.max(0, Math.min(y.length, Math.round(trim.startSeconds * sr)))
  const b = Math.max(a, Math.min(y.length, Math.round(trim.endSeconds * sr)))
  if (start < a || start > b) return start
  return a + leadInStart(y.subarray(a, b), start - a)
}

export function leadInStart(y: Float32Array, start: number): number {
  const sr = ANALYSIS_SAMPLE_RATE
  const hop = Math.trunc(LEVEL_HOP_SECONDS * sr)
  const fine = levelDb(y, FINE_FRAME_HOPS * hop, hop)
  let peak = Number.NEGATIVE_INFINITY
  for (const v of fine) if (v > peak) peak = v
  const attack = fine.findIndex(v => v >= peak - ONSET_BELOW_PEAK_DB)
  const longestGap = Math.round(LEAD_IN_GAP_SECONDS / LEVEL_HOP_SECONDS)
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
    Math.max(
      0,
      first * hop - Math.trunc(ONSET_LEAD_SECONDS * sr),
      start - Math.trunc(LEAD_IN_MAX_SECONDS * sr)
    )
  )
}
