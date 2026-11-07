import type { Song, SongNote, SongNotes, SongSummary } from '@/lib/catalog/song'
import type { RecordedIn } from '@/lib/fart-place'
import type { Performance } from '@/lib/performance'
import { noteName } from '@/lib/pitch'
import { formattedLength, type Recording, recordingName, songPitch } from '@/lib/recordings'

// A Toot: a Song, or a Sound Pad Performance, played by the user's Recordings, kept with its own
// audio (see `CONTEXT.md`). A port of the iPhone app's `Toot.swift` and the parts of
// `Arrangement.swift` a Toot shows.

/**
 * What a Toot keeps of its Arrangement: which Recording plays each of the Song's distinct pitches,
 * and the transposition. As the iPhone app's `Arrangement`.
 */
export type TootArrangement = {
  /** Semitones the Song is moved by: a note of pitch `p` sounds at `p + transposition`. */
  transposition: number
  /** The Recording id that plays each of the Song's distinct pitches (MIDI, in the score's key). */
  recordingForPitch: Record<number, string>
}

/**
 * A Song as a Toot was rendered from it: its tempo, bar lines and notes. A saved Toot keeps its own
 * copy, because the Song Catalog's can change, by a re-import or a Song's end moving, while the
 * Toot's audio stays as it was made (#254).
 */
export type TootScore = Pick<Song, 'bpm'> & SongNotes

/** What a note roll draws: a Song's, or a Sound Pad Toot's taps, one lane per fart. */
export type RollSong = Pick<Song, 'bpm' | 'length_beats' | 'notes' | 'pitches'>

/** One fart of a shared Toot, as anyone with the link sees it: never its Recording's id. */
export type SharedFart = {
  /** Its place in the Toot's list, which names its audio (`farts/<place>/audio/`). */
  place: number
  /** "Recording 8". */
  name: string
  /** "1.1 s": its fart's length, as its row shows it. */
  length: string
  /** The fart's loudness bars, each 0…1: 16, as Song Creator draws a fart, however short. */
  levels: number[]
  /** When it was recorded, in ms. */
  recordedAt: number
  /** Analysis has found the fart, so it has audio to play. */
  playable: boolean
} & RecordedIn

/** A row of a shared Toot's "Recordings used". */
export type SharedFartRow = {
  /** The note it plays, "G2". Null on a Sound Pad, where it plays no note of a Song. */
  plays: string | null
  /** The pitch or lane of the roll its notes are on. */
  pitch: number
  /** Its place among the Song's pitches, lowest first, which its color is (`pitchColor`). */
  colorIndex: number
  /** Null once its Recording is deleted: the Toot's own audio still plays it. */
  fart: SharedFart | null
}

/** What a shared Toot is made of, for its page: its roll, and each fart it plays. */
export type SharedTootParts = {
  /** The notes as it was rendered, or a Sound Pad Toot's taps. Null when it keeps none. */
  song: RollSong | null
  /**
   * The Song in the catalog whose notes the page fetches, for a Toot saved before #254 that keeps
   * none of its own. Null with no `song` means no roll: its Song isn't in Farty any more.
   */
  catalogSong: SongSummary | null
  transposition: number
  /** `song`'s pitches are lanes, one per fart: a Sound Pad Toot's. */
  lanes: boolean
  rows: SharedFartRow[]
}

/**
 * A shared Toot's note roll as its owner's profile page draws it (#448), in its banner and its
 * row's square: only its notes, and which pitches a fart plays, nothing of its farts.
 */
export type TootRoll = Pick<SharedTootParts, 'song' | 'catalogSong'> & {
  /** The pitches a fart plays. A note of any other was left out of the Toot, and draws hollow. */
  played: number[]
}

/** The roll of what a shared Toot is made of, as `TootRoll`. */
export function tootRollOf({ song, catalogSong, rows }: SharedTootParts): TootRoll {
  return { song, catalogSong, played: rows.map(row => row.pitch) }
}

/**
 * The distinct pitches of `notes`, lowest first.
 * `profileShares()` in src/db/profiles.ts repeats this rule in SQL for a Profile Page row's dots:
 * the two must agree on which pitches color a Toot's farts, so change both together.
 */
const pitchesOf = (notes: readonly SongNote[]) =>
  [...new Set(notes.map(note => note.pitch))].sort((a, b) => a - b)

/** A score as its note roll draws it. */
export const rollOfScore = ({ bpm, length_beats, notes }: TootScore): RollSong => ({
  bpm,
  length_beats,
  notes,
  pitches: pitchesOf(notes)
})

/**
 * A Sound Pad Toot's taps as a roll (#278, #448): a beat is a second, so each tap's beat is when
 * it was played, where its render starts its fart (`renderPerformance`). A lane for each fart,
 * and each tap as long as its fart plays (`tapSeconds`, by lane), cut at the Toot's end.
 */
export function padRoll(
  { recordings, taps }: Pick<Performance, 'recordings' | 'taps'>,
  tapSeconds: readonly number[],
  seconds: number
): RollSong {
  return {
    bpm: 60,
    length_beats: seconds,
    notes: taps.map(([at, lane]) => ({
      start: at,
      dur: Math.max(0, Math.min(tapSeconds[lane], seconds - at)),
      pitch: lane
    })),
    pitches: recordings.map((_, lane) => lane)
  }
}

/**
 * A note as a Toot's row on its owner's profile page draws it over its waveform (#459): only when
 * it's heard and for how long, in seconds of the Toot's audio, its pitch (a Sound Pad Toot's
 * lane) and its color. Nothing of which fart plays it.
 */
export type RowNote = {
  start: number
  length: number
  pitch: number
  /** Its color (`pitchColor`): its place among the roll's pitches, as `tootFartRows` colors it. */
  color: number
}

/**
 * `song`'s notes that a fart plays (`played`), as a Toot's row draws them (#459): each where its
 * render puts its beat (`noteSeconds`), so it sits on the row's waveform where it's heard and the
 * playhead reaches it as it plays. A note left out of the Toot (#360) isn't heard, so the row
 * leaves it out.
 */
export function rowNotes(song: RollSong, played: readonly number[]): RowNote[] {
  const heard = new Set(played)
  return song.notes
    .filter(note => heard.has(note.pitch))
    .map(note => ({
      ...noteSeconds(song, note),
      pitch: note.pitch,
      color: Math.max(0, song.pitches.indexOf(note.pitch))
    }))
}

/** Room for longer Songs than the catalog's longest, of 64 notes and 26 bars over 64 beats. */
const MAX_SCORE_NOTES = 500
const MAX_SCORE_BEATS = 10_000
const MAX_SCORE_BPM = 1000

const isIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && value >= min && value <= max
const isBeat = (value: unknown) => isIn(value, 0, MAX_SCORE_BEATS)
const isListOfAtMost = (value: unknown, max: number): value is unknown[] =>
  Array.isArray(value) && value.length <= max

/** The score in `value`, only its own fields, or null when it isn't one this app can draw. */
export function parseTootScore(value: unknown): TootScore | null {
  if (typeof value !== 'object' || value === null) return null
  const { bpm, bar_lines, length_beats, notes } = value as Record<string, unknown>
  const valid =
    isIn(bpm, 1, MAX_SCORE_BPM) &&
    isBeat(length_beats) &&
    isListOfAtMost(bar_lines, MAX_SCORE_NOTES) &&
    bar_lines.every(isBeat) &&
    isListOfAtMost(notes, MAX_SCORE_NOTES) &&
    notes.length > 0 &&
    notes.every(note => {
      const { start, dur, pitch } = (note ?? {}) as Record<string, unknown>
      return isBeat(start) && isBeat(dur) && Number.isInteger(pitch) && isIn(pitch, 0, 127)
    })
  if (!valid) return null
  return {
    bpm,
    bar_lines: bar_lines as number[],
    length_beats: length_beats as number,
    notes: (notes as SongNote[]).map(({ start, dur, pitch }) => ({ start, dur, pitch }))
  }
}

/**
 * A Toot just made, not saved yet: its audio is a mono 16-bit WAV at the renderer's rate. Made in
 * Song Creator from a Song, as the iPhone app's `TootDraft`, or on the Sound Pad from a
 * Performance, with no Song (ADR 0017).
 */
export type TootDraft = SongTootDraft | PadTootDraft

export type SongTootDraft = {
  id: string
  song: Song
  arrangement: TootArrangement
  seconds: number
  wav: ArrayBuffer
}

export type PadTootDraft = {
  id: string
  song: null
  performance: Performance
  seconds: number
  wav: ArrayBuffer
}

/** A Sound Pad Toot's title until the user renames it, and what its row says in a Song's place. */
export const PAD_TOOT_TITLE = 'Sound Pad'

/**
 * A saved Toot. Its audio is its own copy, kept by id beside it, so it still plays after a
 * Recording it used is deleted. As the iPhone app's `Toot`. A Toot of a Song keeps its
 * Arrangement; a Toot from the Sound Pad has no Song and keeps its Performance (ADR 0017).
 */
export type Toot = SongToot | PadToot

type SavedToot = {
  id: string
  /** The Song's title, or `PAD_TOOT_TITLE`, until the user renames it. */
  title: string
  createdAt: number
  seconds: number
  /**
   * Its audio was gone when the Toots loaded, or when it was played: it can't play. Worked out
   * then and never stored, as the iPhone app's `isAudioMissing`.
   */
  isAudioMissing?: boolean
}

export type SongToot = SavedToot & {
  songId: string
  arrangement: TootArrangement
  /**
   * What it was rendered from, to draw it and find its notes in its audio. A Toot saved before
   * #254 has none, and reads its Song's notes in the catalog as they are now.
   */
  score?: TootScore
}

export type PadToot = SavedToot & { songId: null; arrangement: null; performance: Performance }

/** A made Toot as it's saved. A Song's keeps the score its audio was rendered from (#254). */
export function savedToot(draft: TootDraft, createdAt: number): Toot {
  const saved = { id: draft.id, createdAt, seconds: draft.seconds }
  if (draft.song === null) {
    const { performance } = draft
    return { ...saved, title: PAD_TOOT_TITLE, songId: null, arrangement: null, performance }
  }
  const { id, title, bpm, bar_lines, length_beats, notes } = draft.song
  return {
    ...saved,
    title,
    songId: id,
    arrangement: draft.arrangement,
    score: { bpm, bar_lines, length_beats, notes }
  }
}

/**
 * A saved Toot's Song as it was rendered, to draw: `summary`, the Song in the catalog now, with the
 * Toot's own score. Null for a Toot that keeps none, which draws its Song's notes as they are now.
 */
export function songAsMade(toot: Toot, summary: SongSummary): Song | null {
  if (toot.songId === null || !toot.score) return null
  const { bpm, bar_lines, length_beats, notes } = toot.score
  const pitches = pitchesOf(notes)
  return {
    ...summary,
    bpm,
    bar_lines,
    length_beats,
    notes,
    lengthBeats: length_beats,
    pitches,
    durations: pitches.map(pitch => notes.filter(n => n.pitch === pitch).map(n => n.dur))
  }
}

/**
 * What finds a saved Toot's notes in its audio: the score it keeps, or for one saved before #254,
 * `song`, its Song's notes as they are now. Undefined while it has neither, and for a Sound Pad's.
 */
export function tootScore(toot: Toot, song?: Song | null): TootScore | undefined {
  if (toot.songId === null) return undefined
  return toot.score ?? (song?.id === toot.songId ? song : undefined)
}

/** A Toot's length as its row shows it: "0:17". As `formattedTootLength`. */
export function formattedTootLength(seconds: number): string {
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** When a Toot was made, as its row shows it: "Today", "Yesterday", or "Oct 19, 2026". */
export function formattedTootDate(createdAt: number, now: Date = new Date()): string {
  const made = new Date(createdAt)
  const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())
  // Rounded, since a day with a daylight saving change is 23 or 25 hours long.
  const daysAgo = Math.round((day(now).getTime() - day(made).getTime()) / 86_400_000)
  if (daysAgo === 0) return 'Today'
  if (daysAgo === 1) return 'Yesterday'
  return made.toLocaleDateString(undefined, { dateStyle: 'medium' })
}

/**
 * What a Toot's row says under its title: "Mary Had a Little Lamb · Today · 0:12", or
 * "… · Audio missing".
 */
export function tootDetails(toot: Toot, songTitle: string, now: Date = new Date()): string {
  const rest = toot.isAudioMissing
    ? ['Audio missing']
    : [formattedTootDate(toot.createdAt, now), formattedTootLength(toot.seconds)]
  return [songTitle, ...rest].join(' · ')
}

/** The note a pitch of the score sounds at, as a MIDI note number. */
export function soundingPitch(arrangement: TootArrangement, pitch: number): number {
  return pitch + arrangement.transposition
}

/** When a note starts and how long it lasts as written, in seconds: `Song.seconds(of:)`. */
export function noteSeconds(
  song: Pick<Song, 'bpm'>,
  note: SongNote
): { start: number; length: number } {
  const beat = 60 / song.bpm
  return { start: note.start * beat, length: note.dur * beat }
}

/**
 * What a selected note shows: "A3 · Recording 20 (G♯3) · 0.4 s", or "A3 · Recording deleted ·
 * 0.4 s" once its Recording is gone, or "F♯3 · No fart · 0.5 s" when no fart plays it, as when
 * the user left its fart out of the Song (#360). As `Arrangement.caption`, without its shift:
 * Songs play each fart raw, at its own pitch (ADR 0012). A Noise-like Recording placed by ear
 * shows its Placed Pitch (ADR 0015), and an unplaced one no note.
 */
export function noteCaption(
  song: Song,
  arrangement: TootArrangement,
  note: SongNote,
  recording: Recording | undefined
): string {
  const name = noteName(soundingPitch(arrangement, note.pitch))
  const length = formattedLength(noteSeconds(song, note).length)
  if (arrangement.recordingForPitch[note.pitch] === undefined) {
    return `${name} · No fart · ${length}`
  }
  if (!recording) return `${name} · Recording deleted · ${length}`
  const pitch = songPitch(recording)
  if (pitch === null) return `${name} · ${recordingName(recording)} · ${length}`
  return `${name} · ${recordingName(recording)} (${noteName(pitch)}) · ${length}`
}
