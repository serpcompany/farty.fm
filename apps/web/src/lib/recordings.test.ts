import { describe, expect, it } from 'vitest'
import { decoded, goldenRecordings } from '@/test-support/golden'
import { heardSomething, levelContrast } from './recordings'

/** Room noise: one-pole low-passed white noise at `rmsDb` dBFS, the same every run. */
function roomNoise(seconds: number, sampleRate: number, rmsDb: number): Float32Array {
  let seed = 7
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  const out = new Float32Array(Math.round(seconds * sampleRate))
  let low = 0
  for (let i = 0; i < out.length; i++) {
    low = 0.97 * low + 0.03 * (random() * 2 - 1)
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
    expect(goldenRecordings).toHaveLength(23)
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

  it('hears nothing in less than one 50 ms level window', () => {
    expect(heardSomething(new Float32Array(100).fill(0.5), 48_000)).toBe(false)
  })

  it('measures the contrast of a fart over its room', async () => {
    const golden = goldenRecordings.find(g => g.id === '017')
    if (!golden) throw new Error('No fixture 017')
    const { samples, sampleRate } = await decoded(golden)
    // 017 is the quietest fixture over its own floor.
    expect(levelContrast(samples, sampleRate)?.contrastDb).toBeGreaterThan(5)
    expect(levelContrast(roomNoise(2, 48_000, -40), 48_000)?.contrastDb).toBeLessThan(5)
  })
})
