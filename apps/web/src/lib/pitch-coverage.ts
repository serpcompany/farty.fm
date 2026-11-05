import { searchKey } from '@/lib/catalog/search-key'
import type { KindChoice, Song, SongSummary } from '@/lib/catalog/song'
import {
  type Arrangement,
  type AutoMapRecording,
  autoMapRecording,
  coveredCount,
  type MissingNote,
  placedAutoMapRecording,
  songPitches
} from '@/lib/engine/auto-map'
import { arrangeChoices, type FartChoices } from '@/lib/engine/fart-choices'
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

// Pitch Coverage of the Song Catalog by the user's Recordings: a port of the iPhone app's
// `PitchCoverage.swift` and `SongListing.swift`. Auto-map (`engine/auto-map.ts`) decides it; this
// module reads its answer the way the screens show it.

/**
 * How much of a Song the user's Melodic Recordings cover: each distinct pitch gets its own Melodic
 * Recording within 3 semitones, or an octave away with an Octave Move (ADR 0004, ADR 0006), and at
 * least as long as the pitch's longest note (ADR 0011). What Compose sorts and splits every Song
 * by, and the Result screen shows (#323). A Song's Fart Choices count (#372): leaving out the only
 * fart that covers a pitch locks the Song here as in Song Creator.
 */
export type CoverageCount = {
  covered: number
  total: number
  /** False when there are no Melodic Recordings at all, Placed Recordings included. */
  hasMelodicRecordings: boolean
  /** An Unlocked Song: every distinct pitch has its own Melodic Recording. */
  unlocked: boolean
}

/**
 * A Song's Pitch Coverage, and the Arrangement Auto-map chose, which says what the Song still
 * needs. As the iPhone app's `CoverageResult`.
 */
export type Coverage = CoverageCount & {
  /** The transposition, in semitones, Auto-map chose. */
  transposition: number
  /**
   * The transposed pitches still needed, lowest first: each as a MIDI note number, with the
   * shortest fart near it that would cover it. A fart too short for a pitch leaves it missing.
   */
  missing: MissingNote[]
  /** The Melodic Recording that covers each covered pitch, keyed by the Song's pitch (score key). */
  recordingForPitch: Map<number, string>
}

/**
 * Recordings as Auto-map reads them: the ones the user placed on a note, as Melodic Recordings at
 * their Placed Pitch (ADR 0015), even when a later analysis found a Recording Pitch (ADR 0017), and
 * the other analyzed ones with a Recording Pitch, each at its Trim's length (ADR 0019). None the
 * user left out with "No note" (`isLeftOut`, #314).
 */
export function autoMapRecordings(recordings: readonly Recording[]): AutoMapRecording[] {
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

/**
 * How long a Recording's fart lasts, in seconds: its single clean gesture, without the silence
 * around it, or the fart found between its Trim's handles (ADR 0019), which is the length the
 * unlock rule measures (ADR 0011, ADR 0012). Before analysis has found the fart, the whole take.
 */
export function fartSeconds(recording: Recording): number {
  if (recording.analysis.state !== 'analyzed') return recording.seconds
  return autoMapRecording(recording.id, recording.analysis.analysis, songTrim(recording))
    .gestureSeconds
}

/**
 * A Recording's fart length as its rows show it: "2.9 s". Rounded down to 0.1 s, as a missing
 * note's length is rounded up, so a fart shown as long as a locked Song needs ("Needs a fart near
 * F3 (3.0 s)") is long enough. Rounded to the nearest, a 2.96 s fart would show 3.0 s and still be
 * too short for a 2.975 s note. The 1e-9 keeps float noise from taking 0.1 s off an exact tenth.
 */
export function formattedFartLength(recording: Recording): string {
  return formattedFartSeconds(fartSeconds(recording))
}

/** A fart `seconds` long as rows show it, rounded down. */
function formattedFartSeconds(seconds: number): string {
  return formattedLength(Math.floor(seconds * 10 + 1e-9) / 10)
}

/** A catalog Song as the engine takes it. */
export function engineSong(song: Song): EngineSong {
  return {
    bpm: song.bpm,
    bar_lines: song.bar_lines,
    length_beats: song.length_beats,
    notes: [...song.notes]
  }
}

/**
 * The Arrangement Song Creator renders for `song` with the Melodic ones among `recordings`: the
 * one Auto-map chooses, which `coverageOf` reads, changed by the user's Fart Choices for the Song
 * when it has any (#360).
 */
export function arrangementOf(
  song: Song,
  recordings: readonly Recording[],
  choices: FartChoices | null = null
): Arrangement {
  return arrangeChoices(songPitches(engineSong(song)), autoMapRecordings(recordings), choices)
}

/**
 * Auto-map of `song` with the Melodic ones among `recordings` and the Song's Fart Choices, from the
 * Song Catalog's index: the same Arrangement `arrangementOf` chooses from the Song's notes
 * (`arrangeChoices`). Ties break on Recording ids.
 */
export function coverageOf(
  song: SongSummary,
  recordings: readonly Recording[],
  choices: FartChoices | null = null
): Coverage {
  const melodic = autoMapRecordings(recordings)
  const result = arrangeChoices(song, melodic, choices)
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
export function coverageFraction(coverage: Pick<CoverageCount, 'covered' | 'total'>): number {
  return coverage.total === 0 ? 0 : coverage.covered / coverage.total
}

/** "3 of 4 notes covered", or "All 4 notes covered" when unlocked. */
export function coverageSummary(
  coverage: Pick<CoverageCount, 'covered' | 'total' | 'unlocked'>
): string {
  return coverage.unlocked
    ? `All ${coverage.total} notes covered`
    : `${coverage.covered} of ${coverage.total} notes covered`
}

const andList = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' })

/**
 * The notes still needed, with their octave and how long a fart each needs: "D3 (0.5 s) and F3
 * (1.2 s)". Null when nothing is missing.
 */
export function missingNotes(coverage: Pick<Coverage, 'missing'>): string | null {
  const names = coverage.missing.map(m => `${noteName(m.midi)} (${m.seconds.toFixed(1)} s)`)
  return names.length === 0 ? null : andList.format(names)
}

/** The pitch classes (0 = C … 11 = B) of every Melodic Recording and Placed Recording. */
export function collectedPitchClasses(recordings: readonly Recording[]): Set<number> {
  return new Set(
    recordings.flatMap(r => {
      const pitch = songPitch(r)
      return pitch === null ? [] : [pitchClass(pitch)]
    })
  )
}

/**
 * What Pitch Coverage reads from `recordings`, as a string: with the same Fart Choices, equal
 * strings give equal coverage of every Song, so the catalog is matched once per change to the
 * Melodic and Placed Recordings (the iPhone app's `CoverageCache`). Searching, sorting and unplaced
 * Noise-like Recordings never change it.
 */
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

/** A Song with its Pitch Coverage. */
export type SongRow = { song: SongSummary; coverage: CoverageCount }

/** Every changed Song's Fart Choices, by Song id. */
export type AllFartChoices = ReadonlyMap<string, FartChoices>

const noFartChoices: AllFartChoices = new Map()

/**
 * Every Song with its Pitch Coverage, in catalog order: counted, not arranged (`coveredCount`), so
 * a 1,000-Song catalog is counted in a moment on a phone (#323). Only the few Songs with Fart
 * Choices are arranged, since those hold their own transposition (#372). Equal to `coverageOf`'s
 * counts.
 */
export function songRows(
  songs: readonly SongSummary[],
  recordings: readonly Recording[],
  allChoices: AllFartChoices = noFartChoices
): SongRow[] {
  const melodic = autoMapRecordings(recordings)
  const hasMelodicRecordings = melodic.length > 0
  return songs.map(song => {
    const choices = allChoices.get(song.id)
    const covered = choices
      ? arrangeChoices(song, melodic, choices).covered
      : coveredCount(song, melodic)
    const total = song.pitches.length
    return { song, coverage: { covered, total, hasMelodicRecordings, unlocked: covered === total } }
  })
}

/** How Compose orders Songs within each section. */
export type SongOrder = 'closestToUnlocking' | 'mostPopular' | 'fewestNotes' | 'alphabetical'

const titles = new Intl.Collator('en', { numeric: true })

const closestToUnlocking = (a: SongRow, b: SongRow) => {
  const x = coverageFraction(a.coverage)
  const y = coverageFraction(b.coverage)
  if (x !== y) return y - x
  return a.coverage.total - b.coverage.total
}

const orders: Record<SongOrder, (a: SongRow, b: SongRow) => number> = {
  closestToUnlocking,
  mostPopular: (a, b) =>
    b.song.fame - a.song.fame ||
    b.song.views - a.song.views ||
    (b.song.rating ?? 0) - (a.song.rating ?? 0),
  fewestNotes: (a, b) => a.song.pitches.length - b.song.pitches.length,
  alphabetical: (a, b) => titles.compare(a.song.title, b.song.title)
}

/**
 * `rows`, given in catalog order, sorted by `order`. Closest to unlocking puts the highest Pitch
 * Coverage first and, among equals, Songs with fewer notes. Most popular puts the best known Songs
 * first (`fame`, #384) and, among equals, the scores viewed most on MuseScore, then the best rated.
 * Fewest notes puts the Songs with the fewest distinct notes first. Ties keep catalog order.
 */
export function sortRows(rows: readonly SongRow[], order: SongOrder): SongRow[] {
  // Array sort is stable, so ties keep catalog order.
  return [...rows].sort(orders[order])
}

const searchKeys = new WeakMap<SongSummary, readonly string[]>()

/**
 * A Song's title, other names, composer, kind and origin as search compares them, worked out once a
 * Song. The kind and origin let "hymn" find the Hymns and "Irish" the Irish Songs (#384). Every
 * Song is a Song, so the kind Songs isn't searched: "song" finds the titles with the word only.
 */
function namesOf(song: SongSummary): readonly string[] {
  let keys = searchKeys.get(song)
  if (!keys) {
    keys = [
      song.title,
      ...(song.aliases ?? []),
      ...(song.composer ? [song.composer] : []),
      ...(song.kind === 'Songs' ? [] : [song.kind]),
      ...(song.origin ? [song.origin] : [])
    ].map(searchKey)
    searchKeys.set(song, keys)
  }
  return keys
}

/** Compose's Songs: matching a search, split into Unlocked and locked Songs. */
export type SongListing = { unlocked: SongRow[]; locked: SongRow[] }

/**
 * Compose's filters, all on at once when all are given: `ready`, only the Unlocked Songs,
 * `favorites`, only the Songs whose ids it holds, and `kinds`, only the Songs in any of these Kinds
 * (#384, #397), or every Song when there are none.
 */
export type SongFilters = {
  ready?: boolean
  favorites?: ReadonlySet<string> | null
  kinds?: readonly KindChoice[]
}

/** Whether a Kind shows `song`: Well known shows the Well known Songs of every kind. */
function isOfKind(song: SongSummary, kind: KindChoice): boolean {
  return kind === 'Well known' ? song.wellKnown === true : song.kind === kind
}

/**
 * The rows, already sorted, that pass `filters` and whose title, another name, composer, kind or
 * origin contains `query` anywhere, ignoring case, accents and punctuation (`searchKey`):
 * "londonderry" finds Danny Boy, "mozart" every Song by Mozart, and "irish" every Irish Song. A
 * query with no letters or digits matches every Song.
 */
export function songListing(
  sorted: readonly SongRow[],
  query: string,
  { ready = false, favorites = null, kinds = [] }: SongFilters = {}
): SongListing {
  const q = searchKey(query)
  const rows = sorted.filter(
    r =>
      (!ready || r.coverage.unlocked) &&
      (favorites === null || favorites.has(r.song.id)) &&
      (kinds.length === 0 || kinds.some(kind => isOfKind(r.song, kind))) &&
      (q === '' || namesOf(r.song).some(name => name.includes(q)))
  )
  return {
    unlocked: rows.filter(r => r.coverage.unlocked),
    locked: rows.filter(r => !r.coverage.unlocked)
  }
}

/**
 * A Song that just became an Unlocked Song, with its Pitch Coverage from before the save: the
 * locked row the Result's reward opens (#363).
 */
export type Unlock = { song: SongSummary; before: CoverageCount }

/**
 * How the Song Catalog's Pitch Coverage changed when a Recording was added: what the Result screen
 * shows. As the iPhone app's `CoverageChanges`, with each unlock's coverage from before.
 */
export type CoverageChanges = {
  /** Songs that just became Unlocked Songs, in catalog order (`orderUnlocked` orders them). */
  unlocked: Unlock[]
  /** Songs still locked that gained a covered pitch, closest to unlocking first. */
  improved: SongRow[]
  /** The locked Song closest to unlocking, if any Song is still locked. */
  closest: SongRow | null
}

/** Compares every Song's Pitch Coverage before and after the Recordings changed. */
export function coverageChanges(
  songs: readonly SongSummary[],
  before: readonly Recording[],
  after: readonly Recording[],
  allChoices: AllFartChoices = noFartChoices
): CoverageChanges {
  const old = songRows(songs, before, allChoices)
  const now = songRows(songs, after, allChoices)
  const closestFirst = (a: SongRow, b: SongRow) =>
    coverageFraction(b.coverage) - coverageFraction(a.coverage)
  const locked = now.filter(r => !r.coverage.unlocked)
  return {
    unlocked: now.flatMap((r, i) =>
      r.coverage.unlocked && !old[i].coverage.unlocked
        ? [{ song: r.song, before: old[i].coverage }]
        : []
    ),
    improved: now
      .filter((r, i) => !r.coverage.unlocked && r.coverage.covered > old[i].coverage.covered)
      .sort(closestFirst),
    closest: locked.sort(closestFirst)[0] ?? null
  }
}

/**
 * The Songs a save unlocked, best first, as the Result shows them and Try it opens the first (#363):
 * the Favorite Songs, then the scores viewed most on MuseScore, then the best rated, then `unlocked`'s
 * own order, which `coverageChanges` gives in catalog order.
 */
export function orderUnlocked<T extends { song: SongSummary }>(
  unlocked: readonly T[],
  favorites: ReadonlySet<string>
): T[] {
  const favorite = (u: T) => (favorites.has(u.song.id) ? 1 : 0)
  // Array sort is stable, so ties keep the order given.
  return [...unlocked].sort(
    (a, b) =>
      favorite(b) - favorite(a) ||
      b.song.views - a.song.views ||
      (b.song.rating ?? 0) - (a.song.rating ?? 0)
  )
}
