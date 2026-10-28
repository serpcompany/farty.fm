import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { hzToMidi, midiToHz } from '../lib/analysis/numeric'
import { Pyin, sharedPyin } from '../lib/analysis/pyin'
import { resampleToAnalysisRate } from '../lib/analysis/resample'
import { type DecodedFile, decodeFile } from './decode'

export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\/$/, '')
const RECORDINGS_DIR = `${REPO_ROOT}/fixtures/recordings`
const GOLDEN_DIR = `${REPO_ROOT}/fixtures/golden`

export interface GoldenIndex {
  recordings: string[]
  melodic_recordings: string[]
  sample_rate: number
  hop: number
}

export interface GoldenRecording {
  id: string
  file: { name: string; sample_rate: number; channels: number; frames: number }
  gesture: {
    start_sample: number
    end_sample: number
    start_s: number
    end_s: number
    cut_at_reattack: boolean
  }
  pitch_contour: { frames: number; hop: number; midi: (number | null)[] }
  pitch_estimate_midi: number | null
  pitch_confidence: number
  recording_pitch_midi: number | null
  shortest_note_s: number | null
  settle_s: number | null
  melodic: boolean
  noise_like_reason: 'no_steady_pitch' | 'failed_audition' | null
  rms_db: number
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T

export const goldenIndex = readJson<GoldenIndex>(`${GOLDEN_DIR}/index.json`)
export const goldenRecordings = goldenIndex.recordings.map(id =>
  readJson<GoldenRecording>(`${GOLDEN_DIR}/recordings/${id}.json`)
)

const decodes = new Map<string, Promise<DecodedFile>>()
export function decoded(golden: GoldenRecording): Promise<DecodedFile> {
  let d = decodes.get(golden.id)
  if (!d) {
    d = decodeFile(`${RECORDINGS_DIR}/${golden.file.name}`)
    decodes.set(golden.id, d)
  }
  return d
}

export async function analysisAudio(golden: GoldenRecording): Promise<Float32Array> {
  const file = await decoded(golden)
  return resampleToAnalysisRate(file.samples, file.sampleRate)
}

export async function gestureBody(golden: GoldenRecording): Promise<Float64Array> {
  const y = await analysisAudio(golden)
  return Float64Array.from(y.subarray(golden.gesture.start_sample, golden.gesture.end_sample))
}

export function goldenContourHz(golden: GoldenRecording): Float64Array {
  const base = hzToMidi(Pyin.fmin)
  const freqs = sharedPyin().freqs
  return Float64Array.from(golden.pitch_contour.midi, m => {
    if (m === null) return Number.NaN
    const exact = hzToMidi(freqs[Math.round((m - base) * 10)])
    if (Math.abs(exact - m) > 0.00005 + 1e-9) {
      throw new Error(`${golden.id}: ${m} is not on the pYIN grid`)
    }
    return midiToHz(exact)
  })
}

export const CONTOUR_TOLERANCE_MIDI = 0.00005 + 1e-9

export function compareContour(mine: (number | null)[], golden: GoldenRecording) {
  const theirs = golden.pitch_contour.midi
  let voicingAgrees = 0
  let maxDiffMidi = 0
  for (let i = 0; i < Math.min(mine.length, theirs.length); i++) {
    const m = mine[i]
    const g = theirs[i]
    if ((m === null) === (g === null)) voicingAgrees++
    if (m !== null && g !== null) maxDiffMidi = Math.max(maxDiffMidi, Math.abs(m - g))
  }
  return { frames: mine.length, voicingAgrees, maxDiffMidi }
}

export function row(...cells: unknown[]): string {
  return cells.map(cell => String(cell).padEnd(10)).join(' ')
}
