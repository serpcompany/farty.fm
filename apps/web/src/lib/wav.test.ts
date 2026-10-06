import { describe, expect, it } from 'vitest'
import { decodeWav, encodeWav } from './wav'

describe('WAV', () => {
  it('round-trips mono audio within half a 16-bit step', () => {
    const samples = Float32Array.from({ length: 4410 }, (_, i) => Math.sin(i / 10) * 0.8)
    const decoded = decodeWav(encodeWav({ samples, sampleRate: 48_000 }))
    expect(decoded.sampleRate).toBe(48_000)
    expect(decoded.samples.length).toBe(samples.length)
    for (let i = 0; i < samples.length; i++) {
      expect(Math.abs(decoded.samples[i] - samples[i])).toBeLessThanOrEqual(0.5 / 0x8000)
    }
  })

  it('clips samples outside -1…1 instead of wrapping', () => {
    const decoded = decodeWav(
      encodeWav({ samples: Float32Array.from([1.5, -1.5]), sampleRate: 44_100 })
    )
    expect(decoded.samples[0]).toBeCloseTo(1, 3)
    expect(decoded.samples[1]).toBeCloseTo(-1, 3)
  })
})
