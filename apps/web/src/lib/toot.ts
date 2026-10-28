import type { Song, SongNote } from '@/lib/catalog/song'
import { noteName } from '@/lib/pitch'
import { formattedLength, type Recording, recordingName, recordingPitch } from '@/lib/recordings'

// A Toot: a Song played by the user's Recordings, kept with its own audio (see `CONTEXT.md`). A
// port of the iPhone app's `Toot.swift` and the parts of `Arrangement.swift` a Toot shows.

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
 * A Toot just made in Song Creator, not saved yet: its audio is a mono 16-bit WAV at the
 * renderer's rate. As the iPhone app's `TootDraft`.
 */
export type TootDraft = {
  id: string
  song: Song
  arrangement: TootArrangement
  seconds: number
  wav: ArrayBuffer
}

/**
 * A saved Toot. Its audio is its own copy, kept by id beside it, so it still plays after a
 * Recording it used is deleted. As the iPhone app's `Toot`.
 */
export type Toot = {
  id: string
  /** The Song's title until the user renames it. */
  title: string
  songId: string
  createdAt: number
  seconds: number
  arrangement: TootArrangement
  /**
   * Its audio was gone when the Toots loaded, or when it was played: it can't play. Worked out
   * then and never stored, as the iPhone app's `isAudioMissing`.
   */
  isAudioMissing?: boolean
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
 * 0.4 s" once its Recording is gone. As `Arrangement.caption`, without its shift: Songs play each
 * fart raw, at its own pitch (ADR 0012).
 */
export function noteCaption(
  song: Song,
  arrangement: TootArrangement,
  note: SongNote,
  recording: Recording | undefined
): string {
  const name = noteName(soundingPitch(arrangement, note.pitch))
  const length = formattedLength(noteSeconds(song, note).length)
  if (!recording) return `${name} · Recording deleted · ${length}`
  const pitch = recordingPitch(recording)
  if (pitch === null) return `${name} · ${recordingName(recording)} · ${length}`
  return `${name} · ${recordingName(recording)} (${noteName(pitch)}) · ${length}`
}
