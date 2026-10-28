/**
 * A known melody in the Song Catalog, taken from a cited public-domain score (ADR 0003), as the
 * iPhone app's `Song`. The app's Songs are generated into `songs.generated.ts`; none is typed by
 * hand.
 *
 * `bpm`, `bar_lines`, `length_beats`, `pitches` and `notes` keep the names and values of
 * `fixtures/golden/songs/<id>.json`, the reference engine's import of the score, so a Song is
 * what Auto-map and the renderer take.
 */
export type Song = {
  id: string
  title: string
  /** The source and license line, for example "Public domain score · PDMX". */
  source: string
  /** Tempo in beats per minute. */
  bpm: number
  /**
   * Where the score's bars start, in beats from the beginning: a note that starts on one is played
   * slightly louder. Taken from the score's time signatures, so a pickup isn't a bar.
   */
  bar_lines: readonly number[]
  /** How long the melody is, in beats. */
  length_beats: number
  /** The Song's distinct pitches as MIDI note numbers in the score's key, lowest first. */
  pitches: readonly number[]
  /** The melody's notes in time order. */
  notes: readonly SongNote[]
}

/** One note of a Song's melody. */
export type SongNote = {
  /** When the note starts, in beats from the beginning. */
  start: number
  /** How long it lasts, in beats. */
  dur: number
  /** MIDI note number, in the score's key. */
  pitch: number
}
