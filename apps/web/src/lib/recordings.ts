import { ANALYSIS_VERSION } from './analysis/version'
import { nearestNote } from './pitch'

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
  trim?: RecordingTrim | null
  name?: string | null
}

export type Trim = { startSeconds: number; endSeconds: number }

export type RecordingTrim = Trim & { fart: Trim }

export function trimOf(recording: Recording): RecordingTrim | null {
  return recording.trim ?? null
}

export function songTrim(recording: Recording): Trim | null {
  return trimOf(recording)?.fart ?? null
}

export function trimHandles(recording: Recording): Trim | null {
  const trim = trimOf(recording)
  return trim && { startSeconds: trim.startSeconds, endSeconds: trim.endSeconds }
}

export function playedPart(recording: Recording): Trim {
  return trimHandles(recording) ?? { startSeconds: 0, endSeconds: recording.seconds }
}

export function foundPart(recording: Recording): Trim | null {
  if (recording.analysis.state !== 'analyzed') return null
  const { gestureStartSeconds, gestureEndSeconds } = recording.analysis.analysis
  return { startSeconds: gestureStartSeconds, endSeconds: gestureEndSeconds }
}

export function samePart(a: Trim, b: Trim): boolean {
  return (
    Math.abs(a.startSeconds - b.startSeconds) < 0.005 &&
    Math.abs(a.endSeconds - b.endSeconds) < 0.005
  )
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

export const NO_NOTE = -1

export function isLeftOut(recording: Pick<Recording, 'placedPitch'>): boolean {
  return recording.placedPitch === NO_NOTE
}

export const MAXIMUM_NAME_LENGTH = 40

export function defaultName(number: number): string {
  return `Recording ${number}`
}

export function recordingName(recording: Pick<Recording, 'number' | 'name'>): string {
  return recording.name?.trim() || defaultName(recording.number)
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
  return recording.analysis.state === 'analyzed' && isPlaceablePitch(recording.placedPitch)
    ? recording.placedPitch
    : null
}

export function songPitch(recording: Recording): number | null {
  if (isLeftOut(recording)) return null
  return placedPitch(recording) ?? recordingPitch(recording)
}

export function foundNote(recording: Recording): number | null {
  const pitch = recordingPitch(recording)
  return pitch === null ? null : nearestNote(pitch)
}

export function needsReanalysis(recording: Recording): boolean {
  return (
    recording.analysis.state === 'analyzed' &&
    (recording.analysis.analysis.version ?? 0) < ANALYSIS_VERSION
  )
}

export function formattedLength(seconds: number): string {
  return `${seconds.toFixed(1)} s`
}

export const maximumTakeSeconds = 30

const quietestFartDb = -70
const minimumContrastDb = 4

export function heardSomething(samples: Float32Array, sampleRate: number): boolean {
  const levels = new TakeLevels(sampleRate)
  levels.add(samples)
  return levels.heard()
}

export function levelContrast(samples: Float32Array, sampleRate: number): LevelContrast | null {
  const levels = new TakeLevels(sampleRate)
  levels.add(samples)
  return levels.contrast()
}

export type LevelContrast = { peakDb: number; floorDb: number; contrastDb: number }

export class TakeLevels {
  private readonly hop: number
  private readonly frame: number
  private sum = 0
  private readonly sums: number[] = [0]
  private untilBoundary: number
  private readonly levels: number[] = []
  private readonly barLevels: number[] = []

  constructor(sampleRate: number) {
    this.hop = Math.max(1, Math.trunc(0.005 * sampleRate))
    this.frame = 10 * this.hop
    this.untilBoundary = this.hop
  }

  add(batch: Float32Array): void {
    for (let i = 0; i < batch.length; i++) {
      this.sum += batch[i] * batch[i]
      this.untilBoundary -= 1
      if (this.untilBoundary > 0) continue
      this.untilBoundary = this.hop
      this.sums.push(this.sum)
      const end = this.sums.length - 1
      if (end < 10) continue
      const meanSquare = Math.max(0, this.sums[end] - this.sums[end - 10]) / this.frame
      const db = 20 * Math.log10(Math.sqrt(meanSquare) + 1e-9)
      this.levels.push(db)
      if (end % 10 === 0)
        this.barLevels.push(Math.min(1, Math.max(0, (db - quietestFartDb) / -quietestFartDb)))
    }
  }

  contrast(): LevelContrast | null {
    if (this.levels.length === 0) return null
    const sorted = Float64Array.from(this.levels).sort()
    const peakDb = sorted[sorted.length - 1]
    const floorDb = sorted[Math.floor(sorted.length * 0.1)]
    return { peakDb, floorDb, contrastDb: peakDb - floorDb }
  }

  heard(): boolean {
    const level = this.contrast()
    return level !== null && level.peakDb >= quietestFartDb && level.contrastDb >= minimumContrastDb
  }

  get bars(): readonly number[] {
    return this.barLevels
  }
}

const fullLevelPeak = 0.89

export function atFullLevel(samples: Float32Array): Float32Array {
  let peak = 0
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample))
  if (!(peak > 0) || peak >= fullLevelPeak) return samples
  const gain = fullLevelPeak / peak
  return samples.map(sample => sample * gain)
}
