import { describe, expect, it } from 'vitest'
import { autoMapRecording, placedAutoMapRecording, trimSeconds } from '@/lib/engine/auto-map'
import { renderSource } from '@/lib/engine/render-source'
import type { Analysis } from '@/lib/recordings'
import { analysisAudio, decoded, goldenRecordings } from '../../test-support/golden'
import { ANALYSIS_SAMPLE_RATE } from './resample'
import { noteSegment, trimBounds } from './trimming'

// A Trim (ADR 0019): the fart `noteSegment` finds between the picker's handles, as the reference's
// `trim_bounds()` finds it (`tools/melody-lab/test_trim.py` checks the same numbers), and what
// Songs then cut and Auto-map counts.

const sr = ANALYSIS_SAMPLE_RATE
const golden065 = goldenRecordings.find(r => r.id === '065')
if (!golden065) throw new Error('no golden 065')
const samples = (trim: { startSeconds: number; endSeconds: number }) => [
  Math.round(trim.startSeconds * sr),
  Math.round(trim.endSeconds * sr)
]

/** A 150 Hz tone from `start` to `end` seconds of a 2 s take, silent elsewhere. */
function burst(start: number, end: number, level = 0.5): Float32Array {
  return Float32Array.from({ length: 2 * sr }, (_, i) =>
    i >= start * sr && i < end * sr ? level * Math.sin((2 * Math.PI * 150 * i) / sr) : 0
  )
}
/** A short blip, a long gap, then the fart itself: the shape a Trim is for (065's). */
const take = burst(0.2, 0.23, 0.1).map((v, i) => v + burst(0.8, 1.4)[i])

describe('trimBounds', () => {
  it('finds the fart between the handles, and always within them', () => {
    const trim = trimBounds(take, 0.5, 1.9)
    expect(trim.startSeconds).toBeGreaterThanOrEqual(0.8 - 0.013 - 1e-9)
    expect(trim.startSeconds).toBeLessThanOrEqual(0.8)
    expect(trim.endSeconds).toBeGreaterThan(1.4)
    expect(trim.endSeconds).toBeLessThan(1.455)
    for (const [a, b] of [
      [0, 2],
      [0.9, 1.2],
      [0.81, 1.39],
      [0.1, 0.5]
    ]) {
      const [start, end] = samples(trimBounds(take, a, b))
      expect(start).toBeGreaterThanOrEqual(Math.round(a * sr))
      expect(end).toBeLessThanOrEqual(Math.round(b * sr))
      expect(start).toBeLessThan(end)
    }
  })

  it('is the fart analysis found when the handles hold the whole take', () => {
    const { start, end } = noteSegment(take)
    expect(trimBounds(take, 0, take.length / sr)).toEqual({
      startSeconds: start / sr,
      endSeconds: end / sr
    })
  })

  it('keeps at least two samples', () => {
    expect(() => trimBounds(take, 1, 1)).toThrow()
  })

  it("matches the reference on Recording 065's take", async () => {
    // 065 opens with a 30 ms blip at 0.59 s, 0.3 s before its two loud bursts.
    const y = await analysisAudio(golden065)
    expect(samples(trimBounds(y, 0.8, 2.3))).toEqual([39108, 91820])
    expect(samples(trimBounds(y, 1.3, 1.7))).toEqual([59398, 74930])
  })
})

describe('a trimmed Recording in Songs', () => {
  const analysis: Analysis = {
    gestureStartSeconds: 26048 / sr,
    gestureEndSeconds: 91740 / sr,
    cutAtReattack: true,
    pitchEstimateMidi: null,
    pitchConfidence: 0,
    recordingPitchMidi: null,
    shortestNoteSeconds: null,
    settleSeconds: null
  }
  const trim = { startSeconds: 39108 / sr, endSeconds: 91820 / sr }

  it('is cut at the Trim, not where analysis found the fart', async () => {
    const file = await decoded(golden065)
    const audio = { samples: file.samples, sampleRate: file.sampleRate }
    const y = await analysisAudio(golden065)
    const cut = renderSource(audio, analysis, trim).gesture
    expect(cut).toEqual(Float64Array.from(y.subarray(39108, 91820)))
    expect(renderSource(audio, analysis).gesture).toHaveLength(91740 - 26048)
  })

  it("counts the Trim's length, on the note it was placed on", () => {
    const placed = placedAutoMapRecording('065', analysis, 36, trim)
    expect(placed.gestureSeconds).toBe((91820 - 39108) / sr)
    expect(placed.gestureSeconds).toBe(trimSeconds(trim))
    expect(placed.recordingPitchMidi).toBe(36)
    expect(placedAutoMapRecording('065', analysis, 36).gestureSeconds).toBe(
      autoMapRecording('065', analysis).gestureSeconds
    )
  })
})
