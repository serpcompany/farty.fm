import { compareIds } from './auto-map'
import type { Song } from './song'

// Beats (ADR 0014): a port of the reference engine's `plan_beats()` (`tools/melody-lab/engine.py`).
// A Noise-like Recording has no note to play, so in a Song it plays a Beat: its fart, raw, at the
// start of each bar, on the score's bar lines (a pickup isn't a bar, so it gets none). Several
// take turns bar by bar in a fixed order, their ids sorted as Auto-map sorts them: bar k plays
// number k mod n. Beats change nothing Auto-map decides: Pitch Coverage, unlocking and the
// Arrangement stay the Melodic Recordings'.

/** One Beat of a Song: where it plays, in beats, and which Recording plays it. */
export interface SongBeat {
  /** The bar it starts: its index in the Song's `bar_lines`. */
  bar: number
  recordingId: string
  /** The bar line, in beats from the start of the Song. */
  start: number
  /** Beats to the next bar line, or to the Song's end after the last one. */
  dur: number
}

/**
 * The Recordings that play `song`'s Beats, in turn: the Noise-like ones among `noiseLikeIds`, in
 * id order, and only as many as the Song has bars, since the rest never get a turn. Bar k plays
 * number k mod n of them. Empty when there are none, or the Song has no bar lines.
 */
export function beatRecordings(
  song: Pick<Song, 'bar_lines'>,
  noiseLikeIds: readonly string[]
): string[] {
  return [...new Set(noiseLikeIds)].sort(compareIds).slice(0, song.bar_lines.length)
}

/**
 * The Beats of `song` played by `recordingIds` taking turns (`beatRecordings`): one on each bar
 * line, lasting to the next bar line, the last one to the Song's end. The reference's
 * `plan_beats()`.
 */
export function songBeats(
  song: Pick<Song, 'bar_lines' | 'length_beats'>,
  recordingIds: readonly string[]
): SongBeat[] {
  if (recordingIds.length === 0) return []
  const lines = song.bar_lines
  return lines.map((line, bar) => {
    const end = bar + 1 < lines.length ? lines[bar + 1] : song.length_beats
    return {
      bar,
      recordingId: recordingIds[bar % recordingIds.length],
      start: line,
      dur: end - line
    }
  })
}
