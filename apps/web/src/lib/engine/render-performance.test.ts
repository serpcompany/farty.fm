import { beforeAll, describe, expect, it } from 'vitest'
import { resampleToAnalysisRate } from '@/lib/analysis/resample'
import { PAD_PEAK, soundingSpan } from '@/lib/pads'
import type { Performance } from '@/lib/performance'
import { decoded, goldenRecordings, row } from '@/test-support/golden'
import { type PerformanceRecording, renderPerformance, tapSound } from './render-performance'
import { RENDER_SAMPLE_RATE } from './renderer'

// A Sound Pad Performance's render (#278, ADR 0016) on real fixtures: each tap's fart starts at
// the tap's time, to the sample at 44.1 kHz, and the output is nothing but the Recordings' own
// samples, trimmed, faded, at one gain and mixed (ADR 0004, ADR 0012). Measured, as
// `tools/melody-lab/evaluate.py` measures Songs: the onsets by cross-correlation with each fart,
// and the samples against the Recording itself.

const SR = RENDER_SAMPLE_RATE
/** 090 and 084 are 44.1 kHz WAVs; 009 is a 48 kHz MP3, so it's resampled once. */
const FIXTURES = ['090', '084', '009']
const id = (fixture: string) => `00000000-0000-0000-0000-000000000${fixture}`

let recordings: PerformanceRecording[]
/** Each fixture's audio at 44.1 kHz, as the render reads it. */
const atRenderRate = new Map<string, Float32Array>()

beforeAll(async () => {
  recordings = await Promise.all(
    FIXTURES.map(async fixture => {
      const golden = goldenRecordings.find(r => r.id === fixture)
      if (!golden) throw new Error(`no fixture ${fixture}`)
      const file = await decoded(golden)
      atRenderRate.set(id(fixture), resampleToAnalysisRate(file.samples, file.sampleRate))
      return { id: id(fixture), audio: { samples: file.samples, sampleRate: file.sampleRate } }
    })
  )
  expect(recordings.map(r => r.audio.sampleRate)).toEqual([44100, 44100, 48000])
})

/** Where `sound` sits in `samples`, near `near`: the lag of their highest cross-correlation. */
function measuredOnset(samples: Float32Array, sound: Float32Array, near: number, reach = 400) {
  let best = -Infinity
  let at = -1
  for (let lag = Math.max(0, near - reach); lag <= near + reach; lag++) {
    let sum = 0
    for (let k = 0; k < sound.length && lag + k < samples.length; k++) {
      sum += samples[lag + k] * sound[k]
    }
    if (sum > best) {
      best = sum
      at = lag
    }
  }
  return at
}

/** The farts each tap plays, apart: every tap starts after the last one's fart ends. */
function apart(order: string[], start = 0.0371): Performance {
  const recordingIds = [...new Set(order)]
  let at = start
  const taps: [number, number][] = order.map(fixture => {
    const tap: [number, number] = [Math.round(at * 1000) / 1000, recordingIds.indexOf(fixture)]
    const length = tapSound(recordings.find(r => r.id === fixture)?.audio ?? fail()).length
    at += length / SR + 0.2137
    return tap
  })
  return { recordings: recordingIds, taps }
}

const fail = (): never => {
  throw new Error('no Recording')
}

describe('renderPerformance', () => {
  it('starts each tap’s fart at the tap’s time, within a sample at 44.1 kHz', () => {
    const performance = apart([id('090'), id('084'), id('009'), id('090'), id('009')])
    const rendered = renderPerformance(performance, recordings)
    expect(rendered.sampleRate).toBe(44100)
    expect(rendered.gain).toBe(1)
    const rows = performance.taps.map(([at, index], i) => {
      const recordingId = performance.recordings[index]
      const sound = tapSound(recordings.find(r => r.id === recordingId)?.audio ?? fail())
      const expected = Math.round(at * SR)
      const measured = measuredOnset(rendered.samples, sound, expected)
      expect(Math.abs(measured - expected)).toBeLessThanOrEqual(1)
      expect(rendered.onsets[i]).toBe(expected)
      return row(recordingId.slice(-3), at.toFixed(3), expected, measured, measured - expected)
    })
    console.info(['fart\ttap s\texpected\tmeasured\toff (samples)', ...rows].join('\n'))
  })

  it('holds nothing but the Recordings’ own samples: each trimmed, faded and at one gain', () => {
    const performance = apart([id('084'), id('009'), id('090')])
    const { samples } = renderPerformance(performance, recordings)
    let outsideFarts = 0
    let covered = 0
    const rows = performance.taps.map(([at, index]) => {
      const recordingId = performance.recordings[index]
      const own = atRenderRate.get(recordingId) ?? fail()
      const span = soundingSpan(own, SR)
      const onset = Math.round(at * SR)
      // Away from the 3 ms fade in and the 30 ms fade out, each output sample is the Recording's
      // own sample at the same place, times one gain: read at the fart's loudest sample there.
      const from = Math.round(0.003 * SR)
      const to = span.end - span.start - Math.round(0.03 * SR)
      let loudest = from
      for (let k = from; k < to; k++) {
        if (Math.abs(own[span.start + k]) > Math.abs(own[span.start + loudest])) loudest = k
      }
      const gain = samples[onset + loudest] / own[span.start + loudest]
      let worst = 0
      let peak = 0
      for (let k = 0; k < span.end - span.start; k++) {
        peak = Math.max(peak, Math.abs(samples[onset + k]))
        if (k < from || k >= to) continue
        worst = Math.max(worst, Math.abs(samples[onset + k] - own[span.start + k] * gain))
      }
      expect(worst).toBeLessThan(1e-6)
      // The one gain is the Pads': the fart peaks at PAD_PEAK.
      expect(peak).toBeCloseTo(PAD_PEAK, 6)
      covered += span.end - span.start
      for (let k = 0; k < span.end - span.start; k++) samples[onset + k] = 0
      return row(recordingId.slice(-3), gain.toFixed(4), worst.toExponential(2))
    })
    // Between the farts, nothing: no tone, no noise, no tail.
    for (const sample of samples) outsideFarts = Math.max(outsideFarts, Math.abs(sample))
    expect(outsideFarts).toBe(0)
    expect(covered).toBeGreaterThan(SR)
    console.info(
      ['fart\tgain\tmax |out − gain × own|', ...rows, `outside the farts: ${outsideFarts}`].join(
        '\n'
      )
    )
  })

  it('mixes taps that overlap, and ends when the last fart ends', () => {
    const performance: Performance = {
      recordings: [id('090'), id('084')],
      taps: [
        [0, 0],
        [0.1, 1],
        [0.25, 0]
      ]
    }
    const { samples } = renderPerformance(performance, recordings)
    const a = tapSound(recordings[0].audio)
    const b = tapSound(recordings[1].audio)
    const expected = new Float32Array(Math.max(a.length + Math.round(0.25 * SR), b.length + 4410))
    for (const [sound, onset] of [
      [a, 0],
      [b, 4410],
      [a, Math.round(0.25 * SR)]
    ] as const) {
      for (let k = 0; k < sound.length; k++) expected[onset + k] += sound[k]
    }
    expect(samples).toEqual(expected)
  })

  it('turns the whole mix down by one gain, rather than clip, when farts together pass full scale', () => {
    const performance: Performance = {
      recordings: [id('090')],
      taps: [
        [0, 0],
        [0, 0],
        [0, 0]
      ]
    }
    const rendered = renderPerformance(performance, recordings)
    const one = tapSound(recordings[0].audio)
    // Three of the same fart at once peak at 1.5: the gain puts the peak at full scale.
    expect(rendered.gain).toBeCloseTo(0x7fff / 0x8000 / 1.5, 6)
    let worst = 0
    let peak = 0
    for (let k = 0; k < one.length; k++) {
      worst = Math.max(worst, Math.abs(rendered.samples[k] - 3 * one[k] * rendered.gain))
      peak = Math.max(peak, Math.abs(rendered.samples[k]))
    }
    expect(worst).toBeLessThan(1e-6)
    expect(peak).toBeLessThanOrEqual(0x7fff / 0x8000)
  })

  it('throws when a Recording it plays is missing', () => {
    const performance: Performance = { recordings: [id('065')], taps: [[0, 0]] }
    expect(() => renderPerformance(performance, recordings)).toThrow(
      `No audio for Recording ${id('065')}`
    )
  })
})
