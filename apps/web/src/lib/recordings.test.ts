import { describe, expect, it } from 'vitest'
import { decoded, goldenRecordings } from '@/test-support/golden'
import { analyzeRecording } from './analysis/recording-analysis'
import { ANALYSIS_VERSION } from './analysis/version'
import {
  type Analysis,
  type AnalysisState,
  atFullLevel,
  HIGHEST_PLACED_PITCH,
  heardSomething,
  isNoiseLike,
  isPlaceablePitch,
  LOWEST_PLACED_PITCH,
  levelContrast,
  needsReanalysis,
  placedPitch,
  type Recording,
  recordingPitch,
  songPitch
} from './recordings'

/**
 * Steady noise at `rmsDb` dBFS, the same every run: white noise through a one-pole low-pass. The
 * default pole (0.97) is the test's room; 0 is white noise, and 0.995 a low rumble such as HVAC
 * or traffic.
 */
function roomNoise(seconds: number, sampleRate: number, rmsDb: number, pole = 0.97): Float32Array {
  let seed = 7
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  const out = new Float32Array(Math.round(seconds * sampleRate))
  let low = 0
  for (let i = 0; i < out.length; i++) {
    low = pole * low + (1 - pole) * (random() * 2 - 1)
    out[i] = low
  }
  const rms = Math.sqrt(out.reduce((sum, v) => sum + v * v, 0) / out.length)
  const gain = 10 ** (rmsDb / 20) / rms
  return out.map(v => v * gain)
}

/** `samples` turned so its loudest sample is at `peakDb` dBFS, as a quiet microphone takes it. */
function atPeak(samples: Float32Array, peakDb: number): Float32Array {
  const peak = samples.reduce((max, v) => Math.max(max, Math.abs(v)), 0)
  const gain = 10 ** (peakDb / 20) / peak
  return samples.map(v => v * gain)
}

describe('heardSomething', () => {
  // 016, 019, 081 and 086 are shorter than the 0.5 s the old rule asked for.
  it.each(['016', '019', '081', '086'])('hears the short fart %s', async id => {
    const golden = goldenRecordings.find(g => g.id === id)
    if (!golden) throw new Error(`No fixture ${id}`)
    const { samples, sampleRate } = await decoded(golden)
    expect(heardSomething(samples, sampleRate)).toBe(true)
  })

  it('hears every fart in the Fixture Library', async () => {
    expect(goldenRecordings).toHaveLength(32)
    for (const golden of goldenRecordings) {
      const { samples, sampleRate } = await decoded(golden)
      expect(heardSomething(samples, sampleRate), golden.id).toBe(true)
    }
  })

  it('hears nothing in 2 s of silence', () => {
    expect(heardSomething(new Float32Array(96_000), 48_000)).toBe(false)
  })

  it.each([-70, -60, -50, -40])('hears nothing in 2 s of room noise at %i dBFS', rmsDb => {
    expect(heardSomething(roomNoise(2, 48_000, rmsDb), 48_000)).toBe(false)
  })

  it('hears every fart in the Fixture Library with its loudest sample at -50 dBFS (#279)', async () => {
    for (const golden of goldenRecordings) {
      const { samples, sampleRate } = await decoded(golden)
      expect(heardSomething(atPeak(samples, -50), sampleRate), golden.id).toBe(true)
    }
  })

  it('hears no fart with its loudest sample below -70 dBFS', async () => {
    for (const golden of goldenRecordings) {
      const { samples, sampleRate } = await decoded(golden)
      expect(heardSomething(atPeak(samples, -70.5), sampleRate), golden.id).toBe(false)
    }
  })

  // Steady noise reads as contrast by its bandwidth and the take's length (#159 review). A low
  // rumble passes: a known false accept, which reaches Review, where analysis finds no steady note.
  // Since #279 lowered the floor, it passes down to -70 dBFS.
  it.each([
    { noise: 'white noise', pole: 0, seconds: 2, rmsDb: -40, heard: false },
    { noise: 'white noise', pole: 0, seconds: 30, rmsDb: -40, heard: false },
    { noise: 'room noise', pole: 0.97, seconds: 2, rmsDb: -40, heard: false },
    { noise: 'room noise', pole: 0.97, seconds: 30, rmsDb: -40, heard: false },
    { noise: 'low rumble', pole: 0.995, seconds: 2, rmsDb: -40, heard: true },
    { noise: 'low rumble', pole: 0.995, seconds: 30, rmsDb: -40, heard: true },
    { noise: 'low rumble', pole: 0.995, seconds: 2, rmsDb: -60, heard: true }
  ])('$noise for $seconds s at $rmsDb dBFS: heard is $heard', ({ pole, seconds, rmsDb, heard }) => {
    expect(heardSomething(roomNoise(seconds, 48_000, rmsDb, pole), 48_000)).toBe(heard)
  })

  /** Fixture `id` 20 dB quieter, in room noise at `roomDb` dBFS, after 300 ms of that room. */
  async function fartInRoom(id: string, roomDb: number) {
    const golden = goldenRecordings.find(g => g.id === id)
    if (!golden) throw new Error(`No fixture ${id}`)
    const { samples, sampleRate } = await decoded(golden)
    const lead = Math.round(0.3 * sampleRate)
    const take = roomNoise((samples.length + lead) / sampleRate, sampleRate, roomDb)
    for (let i = 0; i < samples.length; i++) take[lead + i] += 0.1 * samples[i]
    return { take, sampleRate }
  }

  it('hears every fart 20 dB quieter in a quiet room (-50 dBFS), with its pre-roll', async () => {
    for (const golden of goldenRecordings) {
      const { take, sampleRate } = await fartInRoom(golden.id, -50)
      expect(heardSomething(take, sampleRate), golden.id).toBe(true)
    }
  })

  it('in a loud room (-40 dBFS), misses only the four faintest farts 20 dB quieter', async () => {
    const missed: string[] = []
    for (const golden of goldenRecordings) {
      const { take, sampleRate } = await fartInRoom(golden.id, -40)
      if (!heardSomething(take, sampleRate)) missed.push(golden.id)
    }
    expect(missed).toEqual(['017', '019', '022', '096'])
  })

  it('hears nothing in less than one 50 ms level window', () => {
    expect(heardSomething(new Float32Array(100).fill(0.5), 48_000)).toBe(false)
  })

  it('measures the contrast of a fart over its room', async () => {
    const golden = goldenRecordings.find(g => g.id === '017')
    if (!golden) throw new Error('No fixture 017')
    const { samples, sampleRate } = await decoded(golden)
    // 017 is the quietest fixture over its own floor.
    expect(levelContrast(samples, sampleRate)?.contrastDb).toBeGreaterThan(4)
    expect(levelContrast(roomNoise(2, 48_000, -40), 48_000)?.contrastDb).toBeLessThan(4)
  })
})

describe('atFullLevel', () => {
  it('turns a quiet take up with one gain, so its loudest sample is at about -1 dBFS', () => {
    const take = Float32Array.from([0.001, -0.004, 0.002, 0])
    const loud = atFullLevel(take)
    expect(loud.map(Math.abs).reduce((max, v) => Math.max(max, v), 0)).toBeCloseTo(0.89, 6)
    loud.forEach((v, i) => {
      expect(v).toBeCloseTo((take[i] * 0.89) / 0.004, 6)
    })
  })

  it('never turns a take down, and leaves silence silent', () => {
    const loud = Float32Array.from([0.5, -0.95, 0.2])
    expect(atFullLevel(loud)).toBe(loud)
    const silence = new Float32Array(480)
    expect(atFullLevel(silence)).toBe(silence)
  })

  // A fart taken 50 dB down and turned up again is analyzed as the fart itself, so the golden
  // answers (`fixtures/golden/`) still hold. Only the gesture's level, `rmsDb`, follows the gain.
  it('gives Recording Analysis the same results on every fart in the Fixture Library', async () => {
    for (const golden of goldenRecordings) {
      const { samples, sampleRate } = await decoded(golden)
      const asTaken = analyzeRecording(samples, sampleRate)
      const turnedUp = analyzeRecording(atFullLevel(atPeak(samples, -50)), sampleRate)
      expect({ ...turnedUp, rmsDb: 0 }, golden.id).toEqual({ ...asTaken, rmsDb: 0 })
    }
  })
})

describe('an analysis an older Recording Analysis made', () => {
  const stored: Analysis = {
    gestureStartSeconds: 0.01,
    gestureEndSeconds: 0.5,
    cutAtReattack: false,
    pitchEstimateMidi: 55.825920593660186,
    pitchConfidence: 0.9,
    recordingPitchMidi: 55.825920593660186,
    shortestNoteSeconds: 0.12
  }
  const recording = (analysis: AnalysisState): Recording => ({
    id: 'r',
    number: 1,
    createdAt: 0,
    seconds: 0.5,
    sampleRate: 44_100,
    waveform: [],
    analysis
  })

  it('runs again, Melodic or not, when it has no version or an older one', () => {
    const noiseLike = { ...stored, recordingPitchMidi: null, shortestNoteSeconds: null }
    for (const analysis of [stored, { ...stored, settleSeconds: 0.087 }, noiseLike]) {
      expect(needsReanalysis(recording({ state: 'analyzed', analysis }))).toBe(true)
    }
    const older = { ...stored, settleSeconds: 0.087, version: ANALYSIS_VERSION - 1 }
    expect(needsReanalysis(recording({ state: 'analyzed', analysis: older }))).toBe(true)
  })

  it('does not run again once the current one made it, or when there is none', () => {
    for (const analysis of [
      { ...stored, settleSeconds: 0.087, version: ANALYSIS_VERSION },
      { ...stored, recordingPitchMidi: null, settleSeconds: null, version: ANALYSIS_VERSION }
    ]) {
      expect(needsReanalysis(recording({ state: 'analyzed', analysis }))).toBe(false)
    }
    expect(needsReanalysis(recording({ state: 'analyzing' }))).toBe(false)
    expect(needsReanalysis(recording({ state: 'notAnalyzed' }))).toBe(false)
  })
})

describe('a Placed Pitch (ADR 0015)', () => {
  const analysis: Analysis = {
    gestureStartSeconds: 0.01,
    gestureEndSeconds: 1.2,
    cutAtReattack: false,
    pitchEstimateMidi: null,
    pitchConfidence: 0.1,
    recordingPitchMidi: null,
    shortestNoteSeconds: null,
    settleSeconds: null
  }
  const noiseLike = (placed?: number | null): Recording => ({
    id: 'r',
    number: 1,
    createdAt: 0,
    seconds: 1.2,
    sampleRate: 44_100,
    waveform: [],
    analysis: { state: 'analyzed', analysis },
    ...(placed === undefined ? {} : { placedPitch: placed })
  })

  it('places a Noise-like Recording on a whole note from C2 to B4', () => {
    expect([LOWEST_PLACED_PITCH, HIGHEST_PLACED_PITCH]).toEqual([36, 71])
    for (const midi of [36, 48, 71]) {
      expect(placedPitch(noiseLike(midi))).toBe(midi)
      expect(songPitch(noiseLike(midi))).toBe(midi)
      expect(recordingPitch(noiseLike(midi))).toBeNull()
    }
    for (const value of [35, 72, 48.5, Number.NaN, '48', null]) {
      expect(isPlaceablePitch(value), String(value)).toBe(false)
    }
  })

  it('is left out by default', () => {
    for (const r of [noiseLike(), noiseLike(null)]) {
      expect(isNoiseLike(r)).toBe(true)
      expect(placedPitch(r)).toBeNull()
      expect(songPitch(r)).toBeNull()
    }
  })

  it('counts for nothing while the Recording is Melodic, or not analyzed', () => {
    const melodic: Recording = {
      ...noiseLike(48),
      analysis: {
        state: 'analyzed',
        analysis: { ...analysis, recordingPitchMidi: 55.3, shortestNoteSeconds: 0.12 }
      }
    }
    expect(isNoiseLike(melodic)).toBe(false)
    expect(placedPitch(melodic)).toBeNull()
    expect(songPitch(melodic)).toBe(55.3)
    for (const state of ['analyzing', 'notAnalyzed'] as const) {
      const r: Recording = { ...noiseLike(48), analysis: { state } }
      expect(isNoiseLike(r)).toBe(false)
      expect(songPitch(r)).toBeNull()
    }
  })
})
