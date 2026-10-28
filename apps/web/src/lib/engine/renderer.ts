import { pairwiseSum, roundHalfEven } from '@/lib/analysis/numeric'
import { ANALYSIS_SAMPLE_RATE } from '@/lib/analysis/resample'

export const RENDER_SAMPLE_RATE = ANALYSIS_SAMPLE_RATE
export const GAP_SECONDS = 0.025
const SHORTEST_NOTE_SECONDS = 0.06
const FADE_IN_SECONDS = 0.003
const LONGEST_FADE_OUT_SECONDS = 0.03
const NOTE_LEVEL_DB = -20
const LEVEL_WINDOW_SECONDS = 0.25
const DOWNBEAT_ACCENT_DB = 1.5
const TAIL_SECONDS = 1
const LIMITER_DRIVE = 1.2
const LIMITER_PEAK = 0.89

export interface RenderSource {
  gesture: Float64Array
}

interface RenderNote {
  source: RenderSource
  targetMidi: number
  startSeconds: number
  lengthSeconds: number
  downbeat: boolean
}

export function noteInBeats(
  source: RenderSource,
  targetMidi: number,
  beats: { start: number; dur: number; bpm: number; beatsPerBar: number }
): RenderNote {
  const spb = 60 / beats.bpm
  const bar = beats.start / beats.beatsPerBar
  return {
    source,
    targetMidi,
    startSeconds: beats.start * spb,
    lengthSeconds: beats.dur * spb,
    downbeat: Math.abs(bar - roundHalfEven(bar)) < 1e-6
  }
}

export function songSeconds(lengthBeats: number, bpm: number): number {
  return lengthBeats * (60 / bpm)
}

interface PlacedNote {
  startSample: number
  lengthSamples: number
  gainDb: number
}

interface RenderOutput {
  samples: Float32Array
  notes: PlacedNote[]
}

export function render(notes: readonly RenderNote[], songLengthSeconds: number): RenderOutput {
  const sr = RENDER_SAMPLE_RATE
  const mix = new Float64Array(Math.trunc((songLengthSeconds + TAIL_SECONDS) * sr))
  const placed: PlacedNote[] = []

  for (const note of notes) {
    const start = Math.trunc(note.startSeconds * sr)
    const maxLength = Math.trunc(
      Math.max(SHORTEST_NOTE_SECONDS, note.lengthSeconds - GAP_SECONDS) * sr
    )
    const segment = note.source.gesture.slice(0, maxLength)
    applyFades(segment)

    const measured = Math.min(segment.length, Math.trunc(LEVEL_WINDOW_SECONDS * sr))
    const squares = new Float64Array(measured)
    for (let i = 0; i < measured; i++) squares[i] = segment[i] * segment[i]
    const rms = Math.sqrt(pairwiseSum(squares, 0, measured) / Math.max(1, measured)) + 1e-9
    const gainDb = NOTE_LEVEL_DB - 20 * Math.log10(rms) + (note.downbeat ? DOWNBEAT_ACCENT_DB : 0)
    const gain = 10 ** (gainDb / 20)

    const end = Math.min(mix.length, start + segment.length)
    for (let i = start; i < end; i++) mix[i] += segment[i - start] * gain
    placed.push({ startSample: start, lengthSamples: segment.length, gainDb })
  }

  return { samples: limit(mix), notes: placed }
}

export function applyFades(segment: Float64Array): void {
  const sr = RENDER_SAMPLE_RATE
  const n = segment.length
  const envelope = new Float64Array(n).fill(1)
  const fadeIn = Math.min(n, Math.trunc(FADE_IN_SECONDS * sr))
  for (let i = 0; i < fadeIn; i++) envelope[i] = linspace(0, 1, fadeIn, i)
  const fadeOut = Math.min(n, Math.trunc(Math.min(LONGEST_FADE_OUT_SECONDS, n / sr / 3) * sr))
  for (let i = 0; i < fadeOut; i++) {
    const ramp = linspace(1, 0, fadeOut, i)
    envelope[n - fadeOut + i] *= ramp * ramp
  }
  for (let i = 0; i < n; i++) segment[i] *= envelope[i]
}

function linspace(start: number, stop: number, num: number, i: number): number {
  if (num === 1) return start
  if (i === num - 1) return stop
  return i * ((stop - start) / (num - 1)) + start
}

export function limit(mix: Float64Array): Float32Array {
  let peak = 0
  for (const v of mix) peak = Math.max(peak, Math.abs(v))
  const out = new Float32Array(mix.length)
  if (!(peak > 0)) return out
  const knee = Math.tanh(LIMITER_DRIVE)
  for (let i = 0; i < mix.length; i++) {
    out[i] = (Math.tanh((mix[i] / peak) * LIMITER_DRIVE) / knee) * LIMITER_PEAK
  }
  return out
}
