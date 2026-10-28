import { pairwiseSum } from '@/lib/analysis/numeric'
import { ANALYSIS_SAMPLE_RATE } from '@/lib/analysis/resample'

// Renders a Song played by Recordings: a port of the reference engine's `render()`
// (`tools/melody-lab/engine.py`). Where the two differ, this follows the reference.
//
// Songs play farts raw (ADR 0012): every note plays its Recording's gesture from the start, at the
// fart's own pitch and speed. Per note, the renderer cuts the gesture at the note's end, fades it
// and sets its gain; then it mixes the notes and limits the peak. Every output sample is a
// Recording's own sample, scaled (ADR 0004): no resampling, oscillators, noise generators,
// resonators, loops or granular re-triggering. Silent Recordings render silence.
//
// Noise-like Recordings play Beats (ADR 0014) the same way: each Beat plays its fart raw from a
// bar line, cut at the next bar line, faded, set `BEAT_LEVEL_DB` from a note's level with no
// accent, and mixed after every note.
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
/** Each note is set to this RMS level over its first `LEVEL_WINDOW_SECONDS`. */
const NOTE_LEVEL_DB = -20
const LEVEL_WINDOW_SECONDS = 0.25
/** Extra gain for notes that start a bar (on one of the score's bar lines). */
const DOWNBEAT_ACCENT_DB = 1.5
/**
 * A Beat's level against a note's, so Beats sit under the melody: the reference's `BEAT_DB`, set
 * by measurement (ADR 0014).
 */
export const BEAT_LEVEL_DB = -15
/** Silence after the last beat, so the last note can ring out. */
const TAIL_SECONDS = 1
/** The limiter's drive and output peak (0.89 is about −1 dBFS). */
const LIMITER_DRIVE = 1.2
const LIMITER_PEAK = 0.89

/** One Recording, ready to play notes (Melodic) or Beats (Noise-like). */
export interface RenderSource {
  /** The Recording's single clean gesture, mono at 44.1 kHz. */
  gesture: Float64Array
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

/** One Beat (ADR 0014): a Noise-like Recording played raw from the start of a bar. */
export interface RenderBeat {
  source: RenderSource
  /** The bar line it starts on, in seconds from the start of the Song. */
  startSeconds: number
  /** Seconds to the next bar line, or to the Song's end after the last one. */
  lengthSeconds: number
}

/** A Beat as `songBeats` places it, in beats, converted to seconds exactly as a note is. */
export function beatInBeats(
  source: RenderSource,
  beats: { start: number; dur: number; bpm: number }
): RenderBeat {
  const spb = 60 / beats.bpm
  return { source, startSeconds: beats.start * spb, lengthSeconds: beats.dur * spb }
}

/** The length of a Song in seconds, for `render`. */
export function songSeconds(lengthBeats: number, bpm: number): number {
  return lengthBeats * (60 / bpm)
}

/** Where and how loud a note or a Beat was placed. */
export interface PlacedNote {
  startSample: number
  lengthSamples: number
  gainDb: number
}

export interface RenderOutput {
  /** Mono, 44.1 kHz, peak at about −1 dBFS. */
  samples: Float32Array
  notes: PlacedNote[]
  /** The Beats, in the order given. */
  beats: PlacedNote[]
}

/**
 * Renders the notes, then the Beats, offline. The output is one second longer than `songSeconds`
 * (`songSeconds(lengthBeats, bpm)`). With no Beats it is the notes' render alone, as before Beats.
 *
 * Synchronous and CPU-bound: run it in a Web Worker.
 */
export function render(
  notes: readonly RenderNote[],
  songLengthSeconds: number,
  beats: readonly RenderBeat[] = []
): RenderOutput {
  const mix = new Float64Array(Math.trunc((songLengthSeconds + TAIL_SECONDS) * RENDER_SAMPLE_RATE))
  const placedNotes = notes.map(note => place(mix, note, note.downbeat ? DOWNBEAT_ACCENT_DB : 0))
  const placedBeats = beats.map(beat => place(mix, beat, BEAT_LEVEL_DB))
  return { samples: limit(mix), notes: placedNotes, beats: placedBeats }
}

/**
 * Mixes one fart into `mix` from `startSeconds`: the Recording's gesture from its start, cut at
 * the slot's end (its length less the gap, at least 60 ms) or where the fart ends, faded, and set
 * to the note level plus `extraDb`. A fart that runs past the end of the mix is clipped there.
 */
function place(
  mix: Float64Array,
  slot: { source: RenderSource; startSeconds: number; lengthSeconds: number },
  extraDb: number
): PlacedNote {
  const sr = RENDER_SAMPLE_RATE
  const start = Math.trunc(slot.startSeconds * sr)
  const maxLength = Math.trunc(
    Math.max(SHORTEST_NOTE_SECONDS, slot.lengthSeconds - GAP_SECONDS) * sr
  )
  // The fart as recorded, cut at the slot's end, or shorter if the fart ends first.
  const segment = slot.source.gesture.slice(0, maxLength)
  applyFades(segment)

  const measured = Math.min(segment.length, Math.trunc(LEVEL_WINDOW_SECONDS * sr))
  const squares = new Float64Array(measured)
  for (let i = 0; i < measured; i++) squares[i] = segment[i] * segment[i]
  const rms = Math.sqrt(pairwiseSum(squares, 0, measured) / Math.max(1, measured)) + 1e-9
  const gainDb = NOTE_LEVEL_DB - 20 * Math.log10(rms) + extraDb
  const gain = 10 ** (gainDb / 20)

  const end = Math.min(mix.length, start + segment.length)
  for (let i = start; i < end; i++) mix[i] += segment[i - start] * gain
  return { startSample: start, lengthSamples: segment.length, gainDb }
}

/**
 * Linear 3 ms fade-in and a squared fade-out of up to 30 ms (a third of the note if shorter), as
 * the reference's envelope: `np.linspace` ramps multiplied into a ones array, then into the note.
 */
export function applyFades(segment: Float64Array): void {
  const sr = RENDER_SAMPLE_RATE
  const n = segment.length
  const envelope = new Float64Array(n).fill(1)
  const fadeIn = Math.min(n, Math.trunc(FADE_IN_SECONDS * sr))
  for (let i = 0; i < fadeIn; i++) envelope[i] = linspace(0, 1, fadeIn, i)
  const fadeOut = Math.min(n, Math.trunc(Math.min(LONGEST_FADE_OUT_SECONDS, n / sr / 3) * sr))
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
