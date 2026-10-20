import type { Song } from '@/lib/catalog/song'
import { type AutoMapRecording, arrange, autoMapRecording } from '@/lib/engine/auto-map'
import { noteName, pitchClass } from '@/lib/pitch'
import { type Recording, recordingPitch } from '@/lib/recordings'

// Pitch Coverage of the Song Catalog by the user's Recordings: a port of the iPhone app's
// `PitchCoverage.swift` and `SongListing.swift`. Auto-map (`engine/auto-map.ts`) decides it; this
// module reads its answer the way the screens show it.

/**
 * A Song's Pitch Coverage by the user's Melodic Recordings, and the Arrangement Auto-map chose:
 * each distinct pitch gets its own Melodic Recording within 3 semitones, or an octave away with an
 * Octave Move (ADR 0004, ADR 0006). As the iPhone app's `CoverageResult`.
 */
export type Coverage = {
  covered: number
  total: number
  /** The transposition, in semitones, Auto-map chose. */
  transposition: number
  /** The transposed pitches still needed, as MIDI note numbers, lowest first. */
  missing: number[]
  /** The Melodic Recording that covers each covered pitch, keyed by the Song's pitch (score key). */
  recordingForPitch: Map<number, string>
  /** False when there are no Melodic Recordings at all. */
  hasMelodicRecordings: boolean
  /** An Unlocked Song: every distinct pitch has its own Melodic Recording. */
  unlocked: boolean
}

/** Recordings as Auto-map reads them: only analyzed ones with a Recording Pitch can play. */
function autoMapRecordings(recordings: readonly Recording[]): AutoMapRecording[] {
  return recordings.flatMap(r =>
    r.analysis.state === 'analyzed' &&
    r.analysis.analysis.recordingPitchMidi !== null &&
    r.analysis.analysis.shortestNoteSeconds !== null
      ? [autoMapRecording(r.id, r.analysis.analysis)]
      : []
  )
}

/** Auto-map of `song` with the Melodic ones among `recordings`. Ties break on Recording ids. */
export function coverageOf(song: Song, recordings: readonly Recording[]): Coverage {
  const melodic = autoMapRecordings(recordings)
  const result = arrange(
    {
      bpm: song.bpm,
      beats_per_bar: song.beats_per_bar,
      length_beats: song.length_beats,
      notes: [...song.notes]
    },
    melodic
  )
  const recordingForPitch = new Map<number, string>()
  for (const choice of result.pitches) {
    if (choice.recordingId !== null) recordingForPitch.set(choice.songPitch, choice.recordingId)
  }
  return {
    covered: result.covered,
    total: result.total,
    transposition: result.transposition,
    // Without a Melodic Recording, no transposition is better than another.
    missing: melodic.length === 0 ? [] : result.missingNotes,
    recordingForPitch,
    hasMelodicRecordings: melodic.length > 0,
    unlocked: result.unlocked
  }
}

/** Covered pitches as a fraction, for the Pitch Coverage bar. */
export function coverageFraction(coverage: Coverage): number {
  return coverage.total === 0 ? 0 : coverage.covered / coverage.total
}

/** "3 of 4 notes covered", or "All 4 notes covered" when unlocked. */
export function coverageSummary(coverage: Coverage): string {
  return coverage.unlocked
    ? `All ${coverage.total} notes covered`
    : `${coverage.covered} of ${coverage.total} notes covered`
}

const andList = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' })

/**
 * The notes still needed, with their octave: "D3 and F3", or with a `limit` of 3,
 * "D3, F3, A3, and 2 more". Null when nothing is missing.
 */
export function missingNotes(coverage: Coverage, limit?: number): string | null {
  const names = coverage.missing.map(noteName)
  if (names.length === 0) return null
  if (limit === undefined || names.length <= limit) return andList.format(names)
  return andList.format([...names.slice(0, limit), `${names.length - limit} more`])
}

/** The pitch classes (0 = C … 11 = B) of every Melodic Recording. */
export function collectedPitchClasses(recordings: readonly Recording[]): Set<number> {
  return new Set(
    recordings.flatMap(r => {
      const pitch = recordingPitch(r)
      return pitch === null ? [] : [pitchClass(pitch)]
    })
  )
}

/**
 * What Pitch Coverage reads from `recordings`, as a string: equal strings give equal coverage of
 * every Song, so the catalog is matched once per change to the Melodic Recordings (the iPhone
 * app's `CoverageCache`). Searching, sorting and Noise-like Recordings never change it.
 */
export function coverageKey(recordings: readonly Recording[]): string {
  return JSON.stringify(
    autoMapRecordings(recordings).map(r => [
      r.id,
      r.recordingPitchMidi,
      r.shortestNoteSeconds,
      r.gestureSeconds
    ])
  )
}

/** A Song with its Pitch Coverage. */
export type SongRow = { song: Song; coverage: Coverage }

/** Every Song with its Pitch Coverage, in catalog order. */
export function songRows(songs: readonly Song[], recordings: readonly Recording[]): SongRow[] {
  return songs.map(song => ({ song, coverage: coverageOf(song, recordings) }))
}

/** How Compose orders Songs within each section. */
export type SongOrder = 'closestToUnlocking' | 'alphabetical'

const titles = new Intl.Collator('en', { numeric: true })

/**
 * `rows`, given in catalog order, sorted by `order`. Closest to unlocking puts the highest Pitch
 * Coverage first and, among equals, Songs with fewer notes. Ties keep catalog order.
 */
export function sortRows(rows: readonly SongRow[], order: SongOrder): SongRow[] {
  const compare =
    order === 'closestToUnlocking'
      ? (a: SongRow, b: SongRow) => {
          const x = coverageFraction(a.coverage)
          const y = coverageFraction(b.coverage)
          if (x !== y) return y - x
          return a.coverage.total - b.coverage.total
        }
      : (a: SongRow, b: SongRow) => titles.compare(a.song.title, b.song.title)
  // Array sort is stable, so ties keep catalog order.
  return [...rows].sort(compare)
}

/** Lowercased, without accents: how a search compares titles. */
function folded(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('en')
}

/** Compose's Songs: matching a search, split into Unlocked and locked Songs. */
export type SongListing = { unlocked: SongRow[]; locked: SongRow[] }

/**
 * The rows, already sorted, whose title contains `query` anywhere, ignoring case and accents. An
 * empty or blank query matches every Song.
 */
export function songListing(sorted: readonly SongRow[], query: string): SongListing {
  const q = folded(query.trim())
  const rows = q === '' ? sorted : sorted.filter(r => folded(r.song.title).includes(q))
  return {
    unlocked: rows.filter(r => r.coverage.unlocked),
    locked: rows.filter(r => !r.coverage.unlocked)
  }
}

/**
 * How the Song Catalog's Pitch Coverage changed when a Recording was added: what the Result screen
 * shows. As the iPhone app's `CoverageChanges`.
 */
export type CoverageChanges = {
  /** Songs that just became Unlocked Songs, in catalog order. */
  unlocked: Song[]
  /** Songs still locked that gained a covered pitch, closest to unlocking first. */
  improved: SongRow[]
  /** The locked Song closest to unlocking, if any Song is still locked. */
  closest: SongRow | null
}

/** Compares every Song's Pitch Coverage before and after the Recordings changed. */
export function coverageChanges(
  songs: readonly Song[],
  before: readonly Recording[],
  after: readonly Recording[]
): CoverageChanges {
  const old = songRows(songs, before)
  const now = songRows(songs, after)
  const closestFirst = (a: SongRow, b: SongRow) =>
    coverageFraction(b.coverage) - coverageFraction(a.coverage)
  const locked = now.filter(r => !r.coverage.unlocked)
  return {
    unlocked: now
      .filter((r, i) => r.coverage.unlocked && !old[i].coverage.unlocked)
      .map(r => r.song),
    improved: now
      .filter((r, i) => !r.coverage.unlocked && r.coverage.covered > old[i].coverage.covered)
      .sort(closestFirst),
    closest: locked.sort(closestFirst)[0] ?? null
  }
}
