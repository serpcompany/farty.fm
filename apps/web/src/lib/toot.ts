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
  /** The Song's title, when it was made. */
  title: string
  songId: string
  createdAt: number
  seconds: number
  arrangement: TootArrangement
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

/** "+1.2 semitones", "−2.8 semitones" (a minus sign), "0.0 semitones". */
export function semitones(shift: number): string {
  // Halves round away from zero, as Swift's `rounded()`: −2.75 is −2.8.
  const rounded = (Math.sign(shift) * Math.round(Math.abs(shift) * 10)) / 10
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : ''
  return `${sign}${Math.abs(rounded).toFixed(1)} semitones`
}

/**
 * What a selected note shows: "A3 · Recording 20 (G♯3), shifted +1.2 semitones · 0.4 s", or
 * "A3 · Recording deleted · 0.4 s" once its Recording is gone. As `Arrangement.caption`.
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
  const shift = soundingPitch(arrangement, note.pitch) - pitch
  return `${name} · ${recordingName(recording)} (${noteName(pitch)}), shifted ${semitones(shift)} · ${length}`
}
