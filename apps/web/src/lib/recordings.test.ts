import { describe, expect, it } from 'vitest'
import { decoded, goldenRecordings } from '@/test-support/golden'
import { ANALYSIS_VERSION } from './analysis/version'
import {
  type Analysis,
  type AnalysisState,
  heardSomething,
  levelContrast,
  needsReanalysis,
  type Recording
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

  it.each([-50, -40])('hears nothing in 2 s of room noise at %i dBFS', rmsDb => {
    expect(heardSomething(roomNoise(2, 48_000, rmsDb), 48_000)).toBe(false)
  })

  // Steady noise reads as contrast by its bandwidth and the take's length (#159 review). A low
  // rumble passes: a known false accept, which reaches Review, where analysis finds no steady note.
  it.each([
    { noise: 'white noise', pole: 0, seconds: 2, heard: false },
    { noise: 'white noise', pole: 0, seconds: 30, heard: false },
    { noise: 'room noise', pole: 0.97, seconds: 2, heard: false },
    { noise: 'room noise', pole: 0.97, seconds: 30, heard: false },
    { noise: 'low rumble', pole: 0.995, seconds: 2, heard: true },
    { noise: 'low rumble', pole: 0.995, seconds: 30, heard: true }
  ])('$noise for $seconds s at -40 dBFS: heard is $heard', ({ pole, seconds, heard }) => {
    expect(heardSomething(roomNoise(seconds, 48_000, -40, pole), 48_000)).toBe(heard)
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
