import { readFileSync } from 'node:fs'
import type { AutoMapRecording } from '../lib/engine/auto-map'
import type { Song } from '../lib/engine/song'
import type { Analysis } from '../lib/recordings'
import { type GoldenRecording, goldenRecordings, REPO_ROOT } from './golden'

const GOLDEN_DIR = `${REPO_ROOT}/fixtures/golden`
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T

export type Library = 'full' | 'small'

interface Index {
  sample_rate: number
  libraries: Record<Library, string[]>
  songs: { id: string; notes: number }[]
  tie_groups: string[][]
}
const index = readJson<Index>(`${GOLDEN_DIR}/index.json`)

export const libraries = index.libraries
export const songIds = index.songs.map(s => s.id)
export const tieGroups = index.tie_groups

const goldenSongs = new Map(
  songIds.map(id => [id, readJson<Song>(`${GOLDEN_DIR}/songs/${id}.json`)])
)

export function goldenSong(id: string): Song {
  const song = goldenSongs.get(id)
  if (!song) throw new Error(`No golden Song ${id}`)
  return song
}

export interface GoldenArrangement {
  song: string
  library: Library
  unlocked: boolean
  pitch_coverage: { covered: number; total: number }
  transpose: number
  octave_moves: number
  plan_cost: number
  missing: { target_midi: number; seconds: number }[]
  per_pitch: {
    song_pitch: number
    target_midi: number
    recording: string | null
    shift_semitones: number | null
    octave_move: boolean | null
  }[]
  notes:
    | {
        index: number
        song_pitch: number
        target_midi: number
        recording: string
        shift_semitones: number
        heard_cents: number | null
        fart_cents: number | null
        render: { start_s: number; len_s: number; gain_db: number }
      }[]
    | null
  metrics: {
    notes: number
    within_50c_of_fart_pct: number
    within_50c_pct: number
    contour_pct: number | null
    onsets_on_time_pct: number
    notes_with_retrigger: number
  } | null
  render_settings: { bpm: number } | null
}

export function goldenArrangement(library: Library, song: string): GoldenArrangement {
  return readJson<GoldenArrangement>(`${GOLDEN_DIR}/arrangements/${library}/${song}.json`)
}

export interface GoldenCoverage {
  song: string
  unlocked: boolean
  pitch_coverage: { covered: number; total: number }
  transpose: number
  octave_moves: number
  plan_cost: number
  missing: { target_midi: number; seconds: number }[]
  recording_for_pitch: Record<string, string | null>
}

export const coverageSubsets = readJson<{
  subsets: { recordings: string[]; songs: GoldenCoverage[] }[]
}>(`${GOLDEN_DIR}/coverage.json`).subsets

const byId = new Map(goldenRecordings.map(r => [r.id, r]))

export function goldenRecording(id: string): GoldenRecording {
  const r = byId.get(id)
  if (!r) throw new Error(`No golden Recording ${id}`)
  return r
}

export function gestureSeconds(r: GoldenRecording): number {
  return (r.gesture.end_sample - r.gesture.start_sample) / index.sample_rate
}

export function autoMapInput(id: string): AutoMapRecording {
  const r = goldenRecording(id)
  return {
    id,
    recordingPitchMidi: r.melodic ? r.recording_pitch_midi : null,
    shortestNoteSeconds: r.melodic ? r.shortest_note_s : null,
    gestureSeconds: gestureSeconds(r),
    settleSeconds: r.melodic ? r.settle_s : null
  }
}

export function autoMapInputs(ids: readonly string[]): AutoMapRecording[] {
  return ids.map(autoMapInput)
}

export function storedAnalysis(r: GoldenRecording): Analysis {
  return {
    gestureStartSeconds: r.gesture.start_sample / index.sample_rate,
    gestureEndSeconds: r.gesture.end_sample / index.sample_rate,
    cutAtReattack: r.gesture.cut_at_reattack,
    pitchEstimateMidi: r.pitch_estimate_midi,
    pitchConfidence: r.pitch_confidence,
    recordingPitchMidi: r.recording_pitch_midi,
    shortestNoteSeconds: r.shortest_note_s,
    settleSeconds: r.settle_s
  }
}

export function syntheticRecording(
  id: string,
  recordingPitchMidi: number,
  { gestureSeconds = 2, shortestNoteSeconds = 0.1 } = {}
): AutoMapRecording {
  return { id, recordingPitchMidi, shortestNoteSeconds, gestureSeconds, settleSeconds: 0 }
}

export function seededRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) % 2 ** 31
    return state / 2 ** 31
  }
}
