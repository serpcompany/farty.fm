/**
 * A Song's melody as the engine takes it: the shape of `fixtures/golden/songs/<id>.json`, which
 * the reference engine imported from the Song Catalog's cited score (ADR 0003). Never typed by
 * hand.
 */
export interface Song {
  /** The tempo it plays at, in beats per minute. */
  bpm: number
  /** Where the score's bars start, in beats: a note that starts on one is accented. */
  bar_lines: readonly number[]
  /** Where the last note ends, in beats. */
  length_beats: number
  /** The melody's notes in order. */
  notes: SongNote[]
}

export interface SongNote {
  /** When the note starts, in beats from the start of the Song. */
  start: number
  /** Its written length in beats. */
  dur: number
  /** MIDI note number, before transposition. */
  pitch: number
}

/** Seconds per beat, the reference's `60 / bpm`. */
export function secondsPerBeat(song: Pick<Song, 'bpm'>): number {
  return 60 / song.bpm
}
