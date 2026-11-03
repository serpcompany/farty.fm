import { searchKey } from '@/lib/catalog/search-key'
import type { Song, SongSummary } from '@/lib/catalog/song'
import {
  type Arrangement,
  type AutoMapRecording,
  arrange,
  arrangePitches,
  autoMapRecording,
  coveredCount,
  type MissingNote,
  placedAutoMapRecording
} from '@/lib/engine/auto-map'
import type { Song as EngineSong } from '@/lib/engine/song'
import { noteName, pitchClass } from '@/lib/pitch'
import {
  formattedLength,
  isLeftOut,
  placedPitch,
  type Recording,
  songPitch,
  songTrim
} from '@/lib/recordings'

export type CoverageCount = {
  covered: number
  total: number
  hasMelodicRecordings: boolean
  unlocked: boolean
}

export type Coverage = CoverageCount & {
  transposition: number
  missing: MissingNote[]
  recordingForPitch: Map<number, string>
}

function autoMapRecordings(recordings: readonly Recording[]): AutoMapRecording[] {
  return recordings.flatMap(r => {
    if (r.analysis.state !== 'analyzed' || isLeftOut(r)) return []
    const { analysis } = r.analysis
    const placed = placedPitch(r)
    if (placed !== null) return [placedAutoMapRecording(r.id, analysis, placed, songTrim(r))]
    return analysis.recordingPitchMidi !== null && analysis.shortestNoteSeconds !== null
      ? [autoMapRecording(r.id, analysis, songTrim(r))]
      : []
  })
}

export function fartSeconds(recording: Recording): number {
  if (recording.analysis.state !== 'analyzed') return recording.seconds
  return autoMapRecording(recording.id, recording.analysis.analysis, songTrim(recording))
    .gestureSeconds
}

const floatNoise = 1e-9

function roundedDownToTenth(seconds: number): number {
  return Math.floor(seconds * 10 + floatNoise) / 10
}

export function formattedFartLength(recording: Recording): string {
  return formattedLength(roundedDownToTenth(fartSeconds(recording)))
}

export function engineSong(song: Song): EngineSong {
  return {
    bpm: song.bpm,
    bar_lines: song.bar_lines,
    length_beats: song.length_beats,
    notes: [...song.notes]
  }
}

export function arrangementOf(song: Song, recordings: readonly Recording[]): Arrangement {
  return arrange(engineSong(song), autoMapRecordings(recordings))
}

export function coverageOf(song: SongSummary, recordings: readonly Recording[]): Coverage {
  const melodic = autoMapRecordings(recordings)
  const result = arrangePitches(song, melodic)
  const recordingForPitch = new Map<number, string>()
  for (const choice of result.pitches) {
    if (choice.recordingId !== null) recordingForPitch.set(choice.songPitch, choice.recordingId)
  }
  return {
    covered: result.covered,
    total: result.total,
    transposition: result.transposition,
    missing: melodic.length === 0 ? [] : result.missingNotes,
    recordingForPitch,
    hasMelodicRecordings: melodic.length > 0,
    unlocked: result.unlocked
  }
}

export function coverageFraction(coverage: CoverageCount): number {
  return coverage.total === 0 ? 0 : coverage.covered / coverage.total
}

export function coverageSummary(coverage: CoverageCount): string {
  return coverage.unlocked
    ? `All ${coverage.total} notes covered`
    : `${coverage.covered} of ${coverage.total} notes covered`
}

const andList = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' })

export function missingNotes(coverage: Coverage, limit?: number): string | null {
  const names = coverage.missing.map(m => `${noteName(m.midi)} (${m.seconds.toFixed(1)} s)`)
  if (names.length === 0) return null
  if (limit === undefined || names.length <= limit) return andList.format(names)
  return andList.format([...names.slice(0, limit), `${names.length - limit} more`])
}

export function collectedPitchClasses(recordings: readonly Recording[]): Set<number> {
  return new Set(
    recordings.flatMap(r => {
      const pitch = songPitch(r)
      return pitch === null ? [] : [pitchClass(pitch)]
    })
  )
}

export function coverageKey(recordings: readonly Recording[]): string {
  return JSON.stringify(
    autoMapRecordings(recordings).map(r => [
      r.id,
      r.recordingPitchMidi,
      r.shortestNoteSeconds,
      r.gestureSeconds,
      r.settleSeconds
    ])
  )
}

export type SongRow = { song: SongSummary; coverage: CoverageCount }

export function songRows(
  songs: readonly SongSummary[],
  recordings: readonly Recording[]
): SongRow[] {
  const melodic = autoMapRecordings(recordings)
  const hasMelodicRecordings = melodic.length > 0
  return songs.map(song => {
    const covered = coveredCount(song, melodic)
    const total = song.pitches.length
    return { song, coverage: { covered, total, hasMelodicRecordings, unlocked: covered === total } }
  })
}

export type SongOrder = 'closestToUnlocking' | 'alphabetical' | 'favoritesFirst'

const titles = new Intl.Collator('en', { numeric: true })

const closestToUnlocking = (a: SongRow, b: SongRow) => {
  const x = coverageFraction(a.coverage)
  const y = coverageFraction(b.coverage)
  if (x !== y) return y - x
  return a.coverage.total - b.coverage.total
}

const alphabetical = (a: SongRow, b: SongRow) => titles.compare(a.song.title, b.song.title)

export function sortRows(
  rows: readonly SongRow[],
  order: SongOrder,
  favorites: ReadonlySet<string> = new Set()
): SongRow[] {
  const compare =
    order === 'alphabetical'
      ? alphabetical
      : order === 'favoritesFirst'
        ? (a: SongRow, b: SongRow) =>
            Number(favorites.has(b.song.id)) - Number(favorites.has(a.song.id)) ||
            closestToUnlocking(a, b)
        : closestToUnlocking
  return [...rows].sort(compare)
}

const searchKeys = new WeakMap<SongSummary, readonly string[]>()

function namesOf(song: SongSummary): readonly string[] {
  let keys = searchKeys.get(song)
  if (!keys) {
    keys = [song.title, ...(song.aliases ?? [])].map(searchKey)
    searchKeys.set(song, keys)
  }
  return keys
}

export type SongListing = { unlocked: SongRow[]; locked: SongRow[] }

export function songListing(
  sorted: readonly SongRow[],
  query: string,
  only: ReadonlySet<string> | null = null
): SongListing {
  const q = searchKey(query)
  const rows = sorted.filter(
    r =>
      (only === null || only.has(r.song.id)) &&
      (q === '' || namesOf(r.song).some(name => name.includes(q)))
  )
  return {
    unlocked: rows.filter(r => r.coverage.unlocked),
    locked: rows.filter(r => !r.coverage.unlocked)
  }
}

export type CoverageChanges = {
  unlocked: SongSummary[]
  improved: SongRow[]
  closest: SongRow | null
}

export function coverageChanges(
  songs: readonly SongSummary[],
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
