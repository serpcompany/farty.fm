import { describe, expect, test } from 'vitest'
import { decoded, goldenRecordings } from '../../test-support/golden'
import { ANALYSIS_SAMPLE_RATE, resampleToAnalysisRate } from './resample'

describe('decoding and resampling', () => {
  // libsndfile decodes MP3 with mpg123 in gapless mode; the test decoder does the same, so frame
  // counts match exactly (no encoder-delay offset).
  test('fixture files decode to the frame counts libsndfile reports', async () => {
    for (const golden of goldenRecordings) {
      const file = await decoded(golden)
      expect.soft(file.sampleRate, `${golden.id}: sample rate`).toBe(golden.file.sample_rate)
      expect.soft(file.channels, `${golden.id}: channels`).toBe(golden.file.channels)
      expect.soft(file.frames, `${golden.id}: frames`).toBe(golden.file.frames)
      expect.soft(file.samples.length, `${golden.id}: mono samples`).toBe(golden.file.frames)
    }
  })

  test('resampled lengths match the reference: ceil(n * 44100 / rate)', async () => {
    for (const golden of goldenRecordings) {
      const file = await decoded(golden)
      const y = resampleToAnalysisRate(file.samples, file.sampleRate)
      const expected =
        file.sampleRate === ANALYSIS_SAMPLE_RATE
          ? golden.file.frames
          : Math.ceil((golden.file.frames * ANALYSIS_SAMPLE_RATE) / golden.file.sample_rate)
      expect.soft(y.length, `${golden.id}: resampled length`).toBe(expected)
    }
  })

  // Band-limited and time-aligned: an in-band tone comes out as the same tone at the same
  // phase, and a tone above the new Nyquist frequency is rejected. 47,999 Hz and 48,000.5 Hz
  // take the uncached path (too many phases, or no rational step).
  test.each([
    48_000, 16_000, 96_000, 22_050, 47_999, 48_000.5
  ])('a %s Hz tone survives intact', rate => {
    const seconds = 0.5
    const tone = (f: number, sr: number, n: number) =>
      Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * f * i) / sr))
    const n = Math.round(seconds * rate)
    const y = resampleToAnalysisRate(tone(1000, rate, n), rate)
    expect(y.length).toBe(Math.ceil((n * ANALYSIS_SAMPLE_RATE) / rate))
    const ideal = tone(1000, ANALYSIS_SAMPLE_RATE, y.length)
    // Skip the edges, where the input starts and stops abruptly.
    let error = 0
    let power = 0
    for (let i = 4410; i < y.length - 4410; i++) {
      error += (y[i] - ideal[i]) ** 2
      power += ideal[i] ** 2
    }
    expect(10 * Math.log10(error / power)).toBeLessThan(-90)

    if (rate > ANALYSIS_SAMPLE_RATE) {
      const alias = resampleToAnalysisRate(tone(23_000, rate, n), rate)
      let leaked = 0
      for (let i = 4410; i < alias.length - 4410; i++) leaked += alias[i] ** 2
      expect(10 * Math.log10(leaked / power)).toBeLessThan(-90)
    }
  })

  test('44.1 kHz input passes through untouched', () => {
    const x = Float32Array.from({ length: 1000 }, (_, i) => Math.sin(i))
    expect(resampleToAnalysisRate(x, ANALYSIS_SAMPLE_RATE)).toBe(x)
  })
})
