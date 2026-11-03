import { ANALYSIS_SAMPLE_RATE, resampleToAnalysisRate } from './analysis/resample'
import { noteSegment } from './analysis/trimming'
import { leadInStart } from './engine/render-source'
import { type Recording, songPitch } from './recordings'

export const PAD_COUNT = 12

export type PadMapping = readonly (string | null)[]

export type AssignedPads = ReadonlyMap<number, string>

export function fillOrder(recordings: readonly Recording[]): Recording[] {
  const noted = recordings
    .map(recording => ({ recording, pitch: songPitch(recording) }))
    .filter((r): r is { recording: Recording; pitch: number } => r.pitch !== null)
    .sort((a, b) => a.pitch - b.pitch || a.recording.number - b.recording.number)
    .map(r => r.recording)
  const rest = recordings
    .filter(recording => songPitch(recording) === null)
    .sort((a, b) => a.number - b.number)
  return [...noted, ...rest]
}

export function padMapping(recordings: readonly Recording[], assigned: AssignedPads): PadMapping {
  const ids = new Set(recordings.map(recording => recording.id))
  const pads = Array.from({ length: PAD_COUNT }, (_, pad) => {
    const id = assigned.get(pad)
    return id !== undefined && ids.has(id) ? id : null
  })
  const onPads = new Set(pads)
  const free = fillOrder(recordings).filter(recording => !onPads.has(recording.id))
  return pads.map(id => id ?? free.shift()?.id ?? null)
}

export function assignPad(shown: PadMapping, pad: number, id: string): Map<number, string> {
  const kept = new Map<number, string>()
  shown.forEach((shownId, index) => {
    const next = index === pad ? id : shownId
    if (next !== null) kept.set(index, next)
  })
  return kept
}

const WINDOW_SECONDS = 0.01
const BELOW_PEAK_DB = 30
const TAIL_SECONDS = 0.05
const FADE_IN_SECONDS = 0.003
const FADE_OUT_SECONDS = 0.03

export const PAD_PEAK = 0.5

export type Span = { start: number; end: number }

export function soundingSpan(samples: Float32Array, sampleRate: number): Span {
  const window = Math.max(1, Math.round(WINDOW_SECONDS * sampleRate))
  const count = Math.ceil(samples.length / window)
  const power = new Float64Array(count)
  for (let w = 0; w < count; w++) {
    const from = w * window
    const to = Math.min(samples.length, from + window)
    let sum = 0
    for (let i = from; i < to; i++) sum += samples[i] * samples[i]
    power[w] = sum / (to - from)
  }
  const peak = power.reduce((loudest, p) => Math.max(loudest, p), 0)
  if (!(peak > 0)) return { start: 0, end: samples.length }
  const floor = peak * 10 ** (-BELOW_PEAK_DB / 10)
  const last = power.findLastIndex(p => p >= floor)
  return {
    start: fartStart(samples, sampleRate),
    end: Math.min(samples.length, (last + 1) * window + Math.round(TAIL_SECONDS * sampleRate))
  }
}

function fartStart(samples: Float32Array, sampleRate: number): number {
  const y = resampleToAnalysisRate(samples, sampleRate)
  const start = leadInStart(y, noteSegment(y).start)
  return Math.round((start * sampleRate) / ANALYSIS_SAMPLE_RATE)
}

export function padGain(channels: readonly Float32Array[]): number {
  let peak = 0
  for (const channel of channels) {
    for (const sample of channel) peak = Math.max(peak, Math.abs(sample))
  }
  return peak > 0 ? PAD_PEAK / peak : 1
}

export function padSound(
  channels: readonly Float32Array[],
  sampleRate: number
): Float32Array<ArrayBuffer>[] {
  const length = channels[0]?.length ?? 0
  const mix = new Float32Array(length)
  for (const channel of channels) {
    for (let i = 0; i < length; i++) mix[i] += channel[i] / channels.length
  }
  const { start, end } = soundingSpan(mix, sampleRate)
  const n = end - start
  const fadeIn = Math.min(n, Math.round(FADE_IN_SECONDS * sampleRate))
  const fadeOut = Math.min(n, Math.round(FADE_OUT_SECONDS * sampleRate))
  const faded = channels.map(channel => {
    const out = channel.slice(start, end)
    for (let i = 0; i < fadeIn; i++) out[i] *= i / fadeIn
    for (let i = 0; i < fadeOut; i++) out[n - 1 - i] *= i / fadeOut
    return out
  })
  const gain = padGain(faded)
  for (const out of faded) {
    for (let i = 0; i < out.length; i++) out[i] *= gain
  }
  return faded
}
