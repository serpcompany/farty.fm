import { expect, test } from 'vitest'
import { analyzePitch, frameRms } from '@/lib/analysis/recording-pitch'
import { ANALYSIS_SAMPLE_RATE } from '@/lib/analysis/resample'
import { noteName } from '@/lib/pitch'
import { HIGHEST_PLACED_PITCH, LOWEST_PLACED_PITCH } from '@/lib/recordings'
import { analysisAudio, goldenRecordings } from '@/test-support/golden'
import { octaveOf, pianoNote } from './piano-keys'

// The review's piano note, rendered offline and heard as a phone's speaker plays it (#362): a
// fourth-order Butterworth high-pass at 300 Hz, below which an iPhone's speaker plays hardly
// anything. Before #362 a key's fundamental carried most of its note, so D♯2 came through 13 dB
// below the farts of its octave and C2 16 dB below.

const SPEAKER_HZ = 300
/** How far a key's level may be from the median fart of its octave, in dB. */
const LEVEL_DB = 6
/** How far a key's pitch may read from the key, in semitones. */
const PITCH_SEMITONES = 0.25

/** Every key the review offers, C2 to B4. */
const KEYS = Array.from(
  { length: HIGHEST_PLACED_PITCH - LOWEST_PLACED_PITCH + 1 },
  (_, i) => LOWEST_PLACED_PITCH + i
)

/** `scipy.signal.butter(4, SPEAKER_HZ, 'highpass', fs=44100, output='sos')`, run over `y`. */
function speaker(y: ArrayLike<number>): Float64Array {
  let out = Float64Array.from(y)
  // A fourth-order Butterworth is two second-order sections with these Qs (RBJ's cookbook).
  for (const q of [1 / (2 * Math.cos(Math.PI / 8)), 1 / (2 * Math.cos((3 * Math.PI) / 8))]) {
    const w = (2 * Math.PI * SPEAKER_HZ) / ANALYSIS_SAMPLE_RATE
    const alpha = Math.sin(w) / (2 * q)
    const a0 = 1 + alpha
    const b0 = (1 + Math.cos(w)) / 2 / a0
    const b1 = -(1 + Math.cos(w)) / a0
    const a1 = (-2 * Math.cos(w)) / a0
    const a2 = (1 - alpha) / a0
    const x = out
    out = new Float64Array(x.length)
    let x1 = 0
    let x2 = 0
    let y1 = 0
    let y2 = 0
    for (let n = 0; n < x.length; n++) {
      out[n] = b0 * x[n] + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2
      x2 = x1
      x1 = x[n]
      y2 = y1
      y1 = out[n]
    }
  }
  return out
}

/** The loudest frame's level in dBFS, on the evaluator's frames (`evaluate.py`'s `yin_frames`). */
function levelDb(y: Float64Array): number {
  return 20 * Math.log10(Math.max(...frameRms(y, 2048, 256)))
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length / 2
  return Number.isInteger(mid) ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[Math.floor(mid)]
}

const note = (midi: number) => pianoNote(midi, ANALYSIS_SAMPLE_RATE)

test('every key is about as loud as the farts of its octave through a phone speaker', async () => {
  const farts = new Map<number, number[]>()
  for (const golden of goldenRecordings) {
    if (golden.recording_pitch_midi === null) continue
    const octave = octaveOf(Math.round(golden.recording_pitch_midi))
    const levels = farts.get(octave) ?? []
    levels.push(levelDb(speaker(await analysisAudio(golden))))
    farts.set(octave, levels)
  }
  for (const midi of KEYS) {
    const samples = note(midi)
    const peak = samples.reduce((most, sample) => Math.max(most, Math.abs(sample)), 0)
    expect(peak, `${noteName(midi)} clips`).toBeLessThan(1)
    const fartsDb = median(farts.get(octaveOf(midi)) ?? [])
    expect(levelDb(speaker(samples)), noteName(midi)).toBeGreaterThan(fartsDb - LEVEL_DB)
    expect(levelDb(speaker(samples)), noteName(midi)).toBeLessThan(fartsDb + LEVEL_DB)
  }
})

test('every key reads as its own note through a phone speaker', () => {
  for (const midi of KEYS) {
    // Recording Analysis's pitch estimate, as it reads a fart, over the note's first second.
    const heard = speaker(note(midi).subarray(0, ANALYSIS_SAMPLE_RATE))
    const { estimateMidi } = analyzePitch(heard)
    expect(estimateMidi, noteName(midi)).not.toBeNull()
    expect(Math.abs((estimateMidi as number) - midi), noteName(midi)).toBeLessThan(PITCH_SEMITONES)
  }
})
