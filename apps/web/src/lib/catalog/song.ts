/**
 * What kind of Song it is (#383, `tools/catalog/tag.py`'s `KINDS`): each Song has one, and Compose
 * lists each in its Kind menu, in this order, after Well known (#397).
 */
export const songKinds = [
  'Christmas',
  'Kids',
  'Hymns',
  'Anthems',
  'Classical',
  'Songs',
  'Fiddle tunes'
] as const

export type SongKind = (typeof songKinds)[number]

/** One row of Compose's Kind menu (#397): the Well known Songs of every kind, or a kind. */
export type KindChoice = 'Well known' | SongKind

/** The rows of Compose's Kind menu, in their order (#397). */
export const kindChoices: readonly KindChoice[] = ['Well known', ...songKinds]

/**
 * A Song in the Song Catalog's index: what Compose lists, searches, sorts and measures Pitch
 * Coverage by, without its notes (#323). The browser fetches the index once (`loadSongs`) and a
 * Song's notes only when the Song is opened (`loadSong`), so Compose stays quick with 1,000 Songs.
 * Generated into `public/catalog/` (`generate.ts`) from a cited public-domain score (ADR 0003);
 * none is typed by hand.
 */
export type SongSummary = {
  id: string
  title: string
  /**
   * Who wrote the tune, as a cited page names them (#357): "Frédéric Chopin", several joined by
   * " and ", or "Traditional (Irish)" for a folk tune. Absent when it isn't known yet, or the
   * lookup found nobody.
   */
  composer?: string
  /** Other names the Song goes by, which search finds it by too: "Londonderry Air". */
  aliases?: readonly string[]
  /** The source and license line, for example "Public domain score · PDMX". */
  source: string
  /** What kind of Song it is (#383): Compose's Kind menu filters by it, and search finds it by it. */
  kind: SongKind
  /** Where the tune is from, "Irish" or "African American", when a source says (#383). */
  origin?: string
  /**
   * How well known the Song is (#383): its Wikipedia page's pageviews and its PDMX views, each on a
   * log scale, added. Most popular's order (#384).
   */
  fame: number
  /** Set on the Well known Songs (#383), which the Kind menu's first Kind shows. */
  wellKnown?: true
  /** How many times the score was viewed on MuseScore (PDMX's `n_views`): Most popular's ties. */
  views: number
  /** The score's MuseScore rating out of 5, when it has one: Most popular's ties after views. */
  rating?: number
  /** How long the melody is, in beats: `SongNotes.length_beats`, for the Song's length. */
  lengthBeats: number
  /** Tempo in beats per minute. */
  bpm: number
  /** The Song's distinct pitches as MIDI note numbers in the score's key, lowest first. */
  pitches: readonly number[]
  /**
   * The lengths in beats of each pitch's notes, in `pitches`' order and each in time order: all
   * that Auto-map reads of the melody, so Pitch Coverage needs no notes (`SongPitches` and
   * `arrangePitches` in `engine/auto-map.ts`).
   */
  durations: readonly (readonly number[])[]
  /** Where the browser fetches the Song's notes (`SongNotes`), named by their content. */
  notesPath: string
}

/**
 * The rest of a Song: its melody, fetched when the Song is opened. `bar_lines`, `length_beats`
 * and `notes` keep the names and values of `fixtures/golden/songs/<id>.json`, the reference
 * engine's import of the score.
 */
export type SongNotes = {
  /**
   * Where the score's bars start, in beats from the beginning: a note that starts on one is played
   * slightly louder. Taken from the score's time signatures, so a pickup isn't a bar.
   */
  bar_lines: readonly number[]
  /** How long the melody is, in beats. */
  length_beats: number
  /** The melody's notes in time order. */
  notes: readonly SongNote[]
}

/**
 * A known melody in the Song Catalog, with its notes: what Song Creator renders and a Toot's
 * screen shows, as the iPhone app's `Song`.
 */
export type Song = SongSummary & SongNotes

/** One note of a Song's melody. */
export type SongNote = {
  /** When the note starts, in beats from the beginning. */
  start: number
  /** How long it lasts, in beats. */
  dur: number
  /** MIDI note number, in the score's key. */
  pitch: number
}
