import { ANALYSIS_VERSION } from './analysis/version'

export type Analysis = {
  gestureStartSeconds: number
  gestureEndSeconds: number
  cutAtReattack: boolean
  pitchEstimateMidi: number | null
  pitchConfidence: number
  recordingPitchMidi: number | null
  shortestNoteSeconds: number | null
  settleSeconds?: number | null
  version?: number
}

export type AnalysisState =
  | { state: 'analyzing' }
  | { state: 'notAnalyzed' }
  | { state: 'analyzed'; analysis: Analysis }

export type Recording = {
  id: string
  number: number
  createdAt: number
  seconds: number
  sampleRate: number
  waveform: number[]
  analysis: AnalysisState
  placedPitch?: number | null
}

export const LOWEST_PLACED_PITCH = 36
export const HIGHEST_PLACED_PITCH = 71

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

export function recordingPitch(recording: Recording): number | null {
  return recording.analysis.state === 'analyzed'
    ? recording.analysis.analysis.recordingPitchMidi
    : null
}

export function isNoiseLike(recording: Recording): boolean {
  return (
    recording.analysis.state === 'analyzed' &&
    recording.analysis.analysis.recordingPitchMidi === null
  )
}

export function placedPitch(recording: Recording): number | null {
  return isNoiseLike(recording) && isPlaceablePitch(recording.placedPitch)
    ? recording.placedPitch
    : null
}

export function songPitch(recording: Recording): number | null {
  return recordingPitch(recording) ?? placedPitch(recording)
}

export function needsReanalysis(recording: Recording): boolean {
  return (
    recording.analysis.state === 'analyzed' &&
    (recording.analysis.analysis.version ?? 0) < ANALYSIS_VERSION
  )
}

export function firstFartUsed(recording: Recording): boolean {
  return recording.analysis.state === 'analyzed' && recording.analysis.analysis.cutAtReattack
}

export function replaySegment(recording: Recording): { start: number; end: number } | null {
  if (recording.analysis.state !== 'analyzed') return null
  const { gestureStartSeconds: start, gestureEndSeconds } = recording.analysis.analysis
  const end = Math.min(gestureEndSeconds, recording.seconds)
  if (start >= end || (start <= 0 && end >= recording.seconds)) return null
  return { start, end }
}

export function formattedLength(seconds: number): string {
  return `${seconds.toFixed(1)} s`
}

export const maximumTakeSeconds = 30

const quietestFartDb = -50
const minimumContrastDb = 4

export function heardSomething(samples: Float32Array, sampleRate: number): boolean {
  const level = levelContrast(samples, sampleRate)
  return level !== null && level.peakDb >= quietestFartDb && level.contrastDb >= minimumContrastDb
}

export function levelContrast(
  samples: Float32Array,
  sampleRate: number
): { peakDb: number; floorDb: number; contrastDb: number } | null {
  const hop = Math.max(1, Math.trunc(0.005 * sampleRate))
  const frame = 10 * hop
  if (samples.length < frame) return null
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
