import type { Song } from '@/lib/catalog/song'
import {
  type Arrangement,
  type AutoMapRecording,
  arrange,
  autoMapRecording,
  type MissingNote,
  placedAutoMapRecording
} from '@/lib/engine/auto-map'
import type { Song as EngineSong } from '@/lib/engine/song'
import { noteName, pitchClass } from '@/lib/pitch'
import { formattedLength, placedPitch, type Recording, songPitch } from '@/lib/recordings'

export type Coverage = {
  covered: number
  total: number
  transposition: number
  missing: MissingNote[]
  recordingForPitch: Map<number, string>
  hasMelodicRecordings: boolean
  unlocked: boolean
}

function autoMapRecordings(recordings: readonly Recording[]): AutoMapRecording[] {
  return recordings.flatMap(r => {
    if (r.analysis.state !== 'analyzed') return []
    const { analysis } = r.analysis
    if (analysis.recordingPitchMidi !== null && analysis.shortestNoteSeconds !== null) {
      return [autoMapRecording(r.id, analysis)]
    }
    const placed = placedPitch(r)
    return placed === null ? [] : [placedAutoMapRecording(r.id, analysis, placed)]
  })
}

export function fartSeconds(recording: Recording): number {
  return recording.analysis.state === 'analyzed'
    ? autoMapRecording(recording.id, recording.analysis.analysis).gestureSeconds
    : recording.seconds
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

export function coverageOf(song: Song, recordings: readonly Recording[]): Coverage {
  const melodic = autoMapRecordings(recordings)
  const result = arrange(engineSong(song), melodic)
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

export function coverageFraction(coverage: Coverage): number {
  return coverage.total === 0 ? 0 : coverage.covered / coverage.total
}

export function coverageSummary(coverage: Coverage): string {
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

export type SongRow = { song: Song; coverage: Coverage }

export function songRows(songs: readonly Song[], recordings: readonly Recording[]): SongRow[] {
  return songs.map(song => ({ song, coverage: coverageOf(song, recordings) }))
}

export type SongOrder = 'closestToUnlocking' | 'alphabetical'

const titles = new Intl.Collator('en', { numeric: true })

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
  return [...rows].sort(compare)
}

function folded(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('en')
}

export type SongListing = { unlocked: SongRow[]; locked: SongRow[] }

export function songListing(sorted: readonly SongRow[], query: string): SongListing {
  const q = folded(query.trim())
  const rows = q === '' ? sorted : sorted.filter(r => folded(r.song.title).includes(q))
  return {
    unlocked: rows.filter(r => r.coverage.unlocked),
    locked: rows.filter(r => !r.coverage.unlocked)
  }
}

export type CoverageChanges = {
  unlocked: Song[]
  improved: SongRow[]
  closest: SongRow | null
}

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
