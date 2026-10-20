import { exp2, pairwiseSum, roundHalfEven } from '@/lib/analysis/numeric'
import { ANALYSIS_SAMPLE_RATE } from '@/lib/analysis/resample'
import { variableResample } from '@/lib/analysis/variable-resample'

// Renders a Song played by Recordings: a port of `Renderer.swift`, which ports the reference
// engine's `render()` with `tune=1` (`tools/melody-lab/engine.py`). Where the two differ, this
// follows the reference.
//
// Fart-only (ADR 0004): every output sample comes from a Recording's own waveform. Per note, the
// renderer trims (the gesture, then the note length), resamples (`variableResample`), fades and
// sets the gain; then it mixes the notes and limits the peak. There are no oscillators, noise
// generators, resonators, loops or granular re-triggering. Silent Recordings render silence.
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
/** Extra gain for notes that start a bar. */
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
  /** The gesture's pitch contour in Hz, one value per 256 samples, NaN when unvoiced. */
  pitchContourHz: Float64Array
  /** The Recording Pitch in MIDI. */
  recordingPitchMidi: number
}

/** One note of the Song and the Recording that plays it (one row of an Arrangement). */
export interface RenderNote {
  source: RenderSource
  /** The pitch to play, in MIDI. */
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
 * exactly like the reference, so notes land on the same samples.
 */
export function noteInBeats(
  source: RenderSource,
  targetMidi: number,
  beats: { start: number; dur: number; bpm: number; beatsPerBar: number }
): RenderNote {
  const spb = 60 / beats.bpm
  const bar = beats.start / beats.beatsPerBar
  return {
    source,
    targetMidi,
    startSeconds: beats.start * spb,
    lengthSeconds: beats.dur * spb,
    downbeat: Math.abs(bar - roundHalfEven(bar)) < 1e-6
  }
}

/** The length of a Song in seconds, for `render`. */
export function songSeconds(lengthBeats: number, bpm: number): number {
  return lengthBeats * (60 / bpm)
}

/** Where and how loud a note was placed. */
export interface PlacedNote {
  startSample: number
  lengthSamples: number
  gainDb: number
  /** The pitch shift used, in semitones (target minus Recording Pitch, to 0.01). */
  shiftSemitones: number
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
 * Synchronous and CPU-bound: run it in a Web Worker.
 */
export function render(notes: readonly RenderNote[], songLengthSeconds: number): RenderOutput {
  const sr = RENDER_SAMPLE_RATE
  const mix = new Float64Array(Math.trunc((songLengthSeconds + TAIL_SECONDS) * sr))
  const placed: PlacedNote[] = []

  for (const note of notes) {
    const start = Math.trunc(note.startSeconds * sr)
    const maxLength = Math.trunc(
      Math.max(SHORTEST_NOTE_SECONDS, note.lengthSeconds - GAP_SECONDS) * sr
    )
    // The reference rounds the shift to 0.01 semitone (at most 0.5 cent) when it plans.
    const shift = roundTo2(note.targetMidi - note.source.recordingPitchMidi)
    const segment = variableResample(
      note.source.gesture,
      note.source.pitchContourHz,
      exp2(shift / 12),
      1,
      maxLength,
      note.source.recordingPitchMidi
    )
    applyFades(segment)

    const measured = Math.min(segment.length, Math.trunc(LEVEL_WINDOW_SECONDS * sr))
    const squares = new Float64Array(measured)
    for (let i = 0; i < measured; i++) squares[i] = segment[i] * segment[i]
    const rms = Math.sqrt(pairwiseSum(squares, 0, measured) / Math.max(1, measured)) + 1e-9
    const gainDb = NOTE_LEVEL_DB - 20 * Math.log10(rms) + (note.downbeat ? DOWNBEAT_ACCENT_DB : 0)
    const gain = 10 ** (gainDb / 20)

    const end = Math.min(mix.length, start + segment.length)
    for (let i = start; i < end; i++) mix[i] += segment[i - start] * gain
    placed.push({
      startSample: start,
      lengthSamples: segment.length,
      gainDb,
      shiftSemitones: shift
    })
  }

  return { samples: limit(mix), notes: placed }
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

/**
 * Python's `round(x, 2)`: the decimal nearest to `x`'s exact binary value, read back as a double.
 * `toFixed` rounds that same exact value, so the two agree (except on exact decimal ties, which a
 * Recording Pitch on pYIN's grid never produces).
 */
export function roundTo2(x: number): number {
  return Number(x.toFixed(2))
}
