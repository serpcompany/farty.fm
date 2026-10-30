import { pairwiseSum } from '@/lib/analysis/numeric'
import { ANALYSIS_SAMPLE_RATE } from '@/lib/analysis/resample'

// Renders a Song played by Recordings: a port of the reference engine's `render()`
// (`tools/melody-lab/engine.py`). Where the two differ, this follows the reference.
//
// Songs play farts raw (ADR 0012): every note plays its Recording's gesture from the start, at the
// fart's own pitch and speed, with the gesture's attack on the note's beat. The fart's quiet
// lead-in plays just before the beat, in the rest before the note (#287). Per note,
// the renderer cuts the gesture at the note's end, fades it and sets its gain; then it mixes the
// notes and limits the peak. Every output sample is a
// Recording's own sample, scaled (ADR 0004): no resampling, oscillators, noise generators,
// resonators, loops or granular re-triggering. Silent Recordings render silence.
//
// Plain TypeScript with no DOM or Web Audio, so it renders the same in every browser, in a Web
// Worker and in Vitest. Web Audio only plays the result.

/** Output sample rate, the same as Recording Analysis. */
export const RENDER_SAMPLE_RATE = ANALYSIS_SAMPLE_RATE
/** Silence between consecutive notes: a note plays for its length minus this. */
export const GAP_SECONDS = 0.025
/** A note never plays shorter than this, even when its length minus the gap is shorter. */
const SHORTEST_NOTE_SECONDS = 0.06
const FADE_IN_SECONDS = 0.003
/** The fade-out is this long, or a third of the note if that is shorter. Squared curve. */
const LONGEST_FADE_OUT_SECONDS = 0.03
/** Each note is set to this RMS level over the first `LEVEL_WINDOW_SECONDS` from its beat. */
const NOTE_LEVEL_DB = -20
const LEVEL_WINDOW_SECONDS = 0.25
/** Extra gain for notes that start a bar (on one of the score's bar lines). */
const DOWNBEAT_ACCENT_DB = 1.5
/** Silence after the last beat, so the last note can ring out. */
const TAIL_SECONDS = 1
/** The limiter's drive and output peak (0.89 is about −1 dBFS). */
const LIMITER_DRIVE = 1.2
const LIMITER_PEAK = 0.89

/** One Melodic Recording, ready to play notes. */
export interface RenderSource {
  /** The Recording's single clean gesture, mono at 44.1 kHz. */
  gesture: Float64Array
  /**
   * The fart's quiet lead-in, mono at 44.1 kHz: from its first sound up to the gesture
   * (`leadInStart`, #287). It plays before the note's beat, so the attack still lands on it. Empty
   * when the fart opens loud.
   */
  leadIn: Float64Array
}

/** One note of the Song and the Recording that plays it (one row of an Arrangement). */
export interface RenderNote {
  source: RenderSource
  /** The note of the Song, in MIDI. The fart plays at its own pitch, not this one. */
  targetMidi: number
  /** When the note starts, in seconds from the start of the Song. */
  startSeconds: number
  /** The note's written length in seconds (beats × 60 / bpm). */
  lengthSeconds: number
  /** The note starts a bar, so it is played slightly louder. */
  downbeat: boolean
}

/**
 * A note of a Song as the catalog writes it, in beats. Converts to seconds and finds downbeats
 * exactly like the reference, so notes land on the same samples: a note that starts on one of the
 * score's bar lines (`barLines`, the Song's `bar_lines`) starts a bar. A pickup isn't a bar.
 */
export function noteInBeats(
  source: RenderSource,
  targetMidi: number,
  beats: { start: number; dur: number; bpm: number; barLines: readonly number[] }
): RenderNote {
  const spb = 60 / beats.bpm
  return {
    source,
    targetMidi,
    startSeconds: beats.start * spb,
    lengthSeconds: beats.dur * spb,
    downbeat: beats.barLines.some(line => Math.abs(beats.start - line) < 1e-6)
  }
}

/** The length of a Song in seconds, for `render`. */
export function songSeconds(lengthBeats: number, bpm: number): number {
  return lengthBeats * (60 / bpm)
}

/** Where and how loud a note was placed. */
export interface PlacedNote {
  /** The note's beat, where its gesture's attack lands. */
  startSample: number
  /** The gesture played from the beat. */
  lengthSamples: number
  /** The lead-in played before the beat, ending at `startSample` (#287). */
  leadSamples: number
  gainDb: number
}

export interface RenderOutput {
  /** Mono, 44.1 kHz, peak at about −1 dBFS. */
  samples: Float32Array
  notes: PlacedNote[]
}

/**
 * Renders the notes offline. The output is one second longer than `songSeconds`
 * (`songSeconds(lengthBeats, bpm)`).
 *
 * Each note's gesture starts on its beat. Its lead-in plays just before, in the rest before the
 * note: as far back as it reaches, but never before the notes that start earlier end as written
 * or stop playing, nor before the Song's start (#287). So it never fills the gap between two
 * notes, where it hid the next attack from the reference's onset check, and is never mixed over
 * another fart. The note's level is still set from the beat on. `notes` come back in the order
 * given.
 *
 * Synchronous and CPU-bound: run it in a Web Worker.
 */
export function render(notes: readonly RenderNote[], songLengthSeconds: number): RenderOutput {
  const sr = RENDER_SAMPLE_RATE
  const mix = new Float64Array(Math.trunc((songLengthSeconds + TAIL_SECONDS) * sr))
  const placed = new Array<PlacedNote>(notes.length)
  // In the order they start: a stable sort, as the reference's `sorted`.
  const order = notes.map((_, i) => i).sort((a, b) => notes[a].startSeconds - notes[b].startSeconds)
  let playedTo = 0 // where the notes placed so far end as written or stop playing

  for (const index of order) {
    const note = notes[index]
    const start = Math.trunc(note.startSeconds * sr)
    const maxLength = Math.trunc(
      Math.max(SHORTEST_NOTE_SECONDS, note.lengthSeconds - GAP_SECONDS) * sr
    )
    // The fart as recorded, cut at the note's end, or shorter if the fart ends first, after as
    // much of its lead-in as there is room for.
    const body = note.source.gesture.subarray(0, maxLength)
    const leadIn = note.source.leadIn
    const lead = Math.min(leadIn.length, Math.max(0, start - playedTo))
    const segment = new Float64Array(lead + body.length)
    segment.set(leadIn.subarray(leadIn.length - lead), 0)
    segment.set(body, lead)
    applyFades(segment, body.length)

    const measured = Math.min(body.length, Math.trunc(LEVEL_WINDOW_SECONDS * sr))
    const squares = new Float64Array(measured)
    for (let i = 0; i < measured; i++) squares[i] = segment[lead + i] * segment[lead + i]
    const rms = Math.sqrt(pairwiseSum(squares, 0, measured) / Math.max(1, measured)) + 1e-9
    const gainDb = NOTE_LEVEL_DB - 20 * Math.log10(rms) + (note.downbeat ? DOWNBEAT_ACCENT_DB : 0)
    const gain = 10 ** (gainDb / 20)

    const from = start - lead
    const end = Math.min(mix.length, start + body.length)
    for (let i = from; i < end; i++) mix[i] += segment[i - from] * gain
    playedTo = Math.max(
      playedTo,
      start + body.length,
      Math.trunc((note.startSeconds + note.lengthSeconds) * sr)
    )
    placed[index] = { startSample: start, lengthSamples: body.length, leadSamples: lead, gainDb }
  }

  return { samples: limit(mix), notes: placed }
}

/**
 * Linear 3 ms fade-in and a squared fade-out of up to 30 ms (a third of the note if shorter), as
 * the reference's envelope: `np.linspace` ramps multiplied into a ones array, then into the note.
 * `noteLength` is what the fade-out is a third of: the gesture played from the beat, so a lead-in
 * before it doesn't lengthen the fade (#287). The whole segment by default.
 */
export function applyFades(segment: Float64Array, noteLength = segment.length): void {
  const sr = RENDER_SAMPLE_RATE
  const n = segment.length
  const envelope = new Float64Array(n).fill(1)
  const fadeIn = Math.min(n, Math.trunc(FADE_IN_SECONDS * sr))
  for (let i = 0; i < fadeIn; i++) envelope[i] = linspace(0, 1, fadeIn, i)
  const fadeOut = Math.min(
    n,
    Math.trunc(Math.min(LONGEST_FADE_OUT_SECONDS, noteLength / sr / 3) * sr)
  )
  for (let i = 0; i < fadeOut; i++) {
    const ramp = linspace(1, 0, fadeOut, i)
    envelope[n - fadeOut + i] *= ramp * ramp
  }
  for (let i = 0; i < n; i++) segment[i] *= envelope[i]
}

/** Element `i` of `np.linspace(start, stop, num)`: `i × step + start`, and `stop` exactly last. */
function linspace(start: number, stop: number, num: number, i: number): number {
  if (num === 1) return start
  if (i === num - 1) return stop
  return i * ((stop - start) / (num - 1)) + start
}

/** The gentle tanh limiter: peak to about −1 dBFS. Silence stays silence. */
export function limit(mix: Float64Array): Float32Array {
  let peak = 0
  for (const v of mix) peak = Math.max(peak, Math.abs(v))
  const out = new Float32Array(mix.length)
  if (!(peak > 0)) return out
  const knee = Math.tanh(LIMITER_DRIVE)
  for (let i = 0; i < mix.length; i++) {
    out[i] = (Math.tanh((mix[i] / peak) * LIMITER_DRIVE) / knee) * LIMITER_PEAK
  }
  return out
}
