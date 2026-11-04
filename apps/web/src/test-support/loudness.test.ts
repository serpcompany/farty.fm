import { describe, expect, it } from 'vitest'
import { loudness, peakDbfs } from './loudness'

const sine = (amplitude: number, hz: number, rate: number, seconds = 3) =>
  Float64Array.from(
    { length: Math.round(seconds * rate) },
    (_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / rate)
  )

describe('loudness (ITU-R BS.1770-4)', () => {
  it('reads a full-scale 997 Hz sine in one channel at -3.01 LUFS, as the standard says', () => {
    // Within 0.02 LU: without the high-pass's +0.043 dB passband gain it read 0.04 low.
    expect(Math.abs(loudness(sine(1, 997, 48_000), 48_000) + 3.01)).toBeLessThan(0.02)
    expect(Math.abs(loudness(sine(1, 997, 44_100), 44_100) + 3.01)).toBeLessThan(0.02)
  })

  it('follows gain dB for dB, and gates out silence', () => {
    const quiet = sine(10 ** (-20 / 20), 997, 44_100)
    expect(loudness(quiet, 44_100)).toBeCloseTo(-23.01, 1)
    const withSilence = new Float64Array(quiet.length * 3)
    withSilence.set(quiet, quiet.length)
    // Ungated, the silence would read 4.8 LU quieter; only the blocks at the tone's edges count.
    expect(Math.abs(loudness(withSilence, 44_100) + 23.01)).toBeLessThan(0.5)
    expect(loudness(new Float64Array(44_100), 44_100)).toBe(Number.NEGATIVE_INFINITY)
  })

  it('weighs a low hum less than the ear-loud middle', () => {
    expect(loudness(sine(1, 40, 44_100), 44_100)).toBeLessThan(-4)
  })

  it('reads the peak in dBFS', () => {
    expect(peakDbfs([0.1, -0.89, 0.5])).toBeCloseTo(-1.01, 2)
  })
})
