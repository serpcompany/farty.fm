// The reference engine's golden Songs, Arrangements and Pitch Coverage, read from the repo, for the
// Auto-map and renderer tests. Test input only (Node): nothing here ships.
import { readFileSync } from 'node:fs'
import type { AutoMapRecording } from '../lib/engine/auto-map'
import type { Song } from '../lib/engine/song'
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

/** `fixtures/golden/songs/<id>.json`: the shape the engine takes. */
export const goldenSongs = new Map(
  songIds.map(id => [id, readJson<Song>(`${GOLDEN_DIR}/songs/${id}.json`)])
)

export function goldenSong(id: string): Song {
  const song = goldenSongs.get(id)
  if (!song) throw new Error(`No golden Song ${id}`)
  return song
}

/** `fixtures/golden/arrangements/<library>/<song>.json`, as written by `export_golden.py`. */
export interface GoldenArrangement {
  song: string
  library: Library
  unlocked: boolean
  pitch_coverage: { covered: number; total: number }
  transpose: number
  octave_moves: number
  plan_cost: number
  /** The notes no Recording covers, lowest first, and the shortest fart that would cover each. */
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
        /** How far the note sounds from its own fart played dry (ADR 0012). */
        fart_cents: number | null
        render: { start_s: number; len_s: number; gain_db: number; lead_s: number }
      }[]
    | null
  metrics: {
    notes: number
    /** The bar (ADR 0012): notes within ±50 cents of their fart's own pitch. */
    within_50c_of_fart_pct: number
    /** Reported, not gated: notes within ±50 cents of the melody. */
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

/** One `coverage.json` entry: a Song's Pitch Coverage on a subset of the library. */
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

/** The gesture length the reference measures: whole samples at 44.1 kHz. */
export function gestureSeconds(r: GoldenRecording): number {
  return (r.gesture.end_sample - r.gesture.start_sample) / index.sample_rate
}

/** Auto-map's input from the golden analysis (Noise-like Recordings included, as in the app). */
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
