import { describe, expect, it } from 'vitest'
import { decoded, goldenRecordings } from '../test-support/golden'
import { songs } from './catalog/songs.generated'
import {
  assignPad,
  fillOrder,
  PAD_COUNT,
  PAD_PEAK,
  padGain,
  padMapping,
  padSound,
  soundingSpan
} from './pads'
import type { Recording } from './recordings'

// The Sound Pad (#277): which Recording each Pad plays, and how much of it.

/** Recording `number`: Melodic at `pitch`, Noise-like with `pitch` null (placed at `placed`). */
function recording(number: number, pitch: number | null, placed?: number): Recording {
  return {
    id: `r${number}`,
    number,
    createdAt: number,
    seconds: 1,
    sampleRate: 48_000,
    waveform: [0.5],
    analysis: {
      state: 'analyzed',
      analysis: {
        gestureStartSeconds: 0,
        gestureEndSeconds: 1,
        cutAtReattack: false,
        pitchEstimateMidi: pitch,
        pitchConfidence: 0.8,
        recordingPitchMidi: pitch,
        shortestNoteSeconds: pitch === null ? null : 0.5
      }
    },
    placedPitch: placed
  }
}

const notAnalyzed = (number: number): Recording => ({
  ...recording(number, null),
  analysis: { state: 'notAnalyzed' }
})

const none = new Map<number, string>()

describe('fillOrder', () => {
  it('puts the Recordings on a note first, lowest up, then the rest, oldest first', () => {
    const library = [
      recording(1, null),
      recording(2, 55.2),
      recording(3, null, 48),
      notAnalyzed(4),
      recording(5, 41.3),
      recording(6, 55.2)
    ]
    expect(fillOrder(library).map(r => r.number)).toEqual([5, 3, 2, 6, 1, 4])
  })
})

describe('padMapping', () => {
  it('starts with every Pad filled in fill order, and the rest empty', () => {
    const library = [recording(1, 55), recording(2, 41), recording(3, null)]
    expect(padMapping(library, none)).toEqual([
      'r2',
      'r1',
      'r3',
      ...Array(PAD_COUNT - 3).fill(null)
    ])
  })

  it('fills twelve Pads from more Recordings, leaving the rest off', () => {
    const library = Array.from({ length: 15 }, (_, i) => recording(i + 1, 40 + i))
    const pads = padMapping(library, none)
    expect(pads).toHaveLength(PAD_COUNT)
    expect(pads).toEqual(library.slice(0, PAD_COUNT).map(r => r.id))
  })

  it('keeps an assigned Pad, and fills the others with the Recordings on no Pad', () => {
    const library = [recording(1, 41), recording(2, 43), recording(3, 45)]
    // Recording 3 on Pad 1: Pads 2 and 3 fill with 1 and 2.
    expect(padMapping(library, new Map([[0, 'r3']])).slice(0, 4)).toEqual(['r3', 'r1', 'r2', null])
  })

  it('refills a Pad whose Recording was deleted', () => {
    const library = [recording(1, 41), recording(3, 45)]
    expect(padMapping(library, new Map([[1, 'r2']])).slice(0, 3)).toEqual(['r1', 'r3', null])
  })

  it('puts a new Recording on the first empty Pad', () => {
    const before = [recording(1, 41), recording(2, 43)]
    const kept = assignPad(padMapping(before, none), 5, 'r1')
    const after = [...before, recording(3, 30)]
    expect(padMapping(after, kept).slice(0, 6)).toEqual(['r1', 'r2', 'r3', null, null, 'r1'])
  })
})

describe('assignPad', () => {
  it('changes only the Pad touched, as Recordings come and go', () => {
    const library = [recording(1, 41), recording(2, 43), recording(3, 45)]
    const shown = padMapping(library, none)
    const kept = assignPad(shown, 2, 'r1')
    // Recording 3, now on no Pad, goes to the first empty one.
    expect(padMapping(library, kept).slice(0, 5)).toEqual(['r1', 'r2', 'r1', 'r3', null])
    // A lower note recorded later doesn't push the Pads the user saw along.
    const later = [...library, recording(4, 30)]
    expect(padMapping(later, kept).slice(0, 3)).toEqual(['r1', 'r2', 'r1'])
  })

  it('keeps no empty Pad', () => {
    expect([...assignPad(['r1', null, null], 2, 'r2')]).toEqual([
      [0, 'r1'],
      [2, 'r2']
    ])
  })
})

describe('the Pad route', () => {
  it('is no Song’s: `/compose/pad/` comes before the Songs’ `/compose/[song]/`', () => {
    expect(songs.map(song => song.id)).not.toContain('pad')
  })
})

describe('soundingSpan', () => {
  const rate = 48_000
  /** `lead` seconds of silence, `body` seconds of a 200 Hz burst at `level`, `tail` of silence. */
  function take(lead: number, body: number, tail: number, level = 0.5) {
    const samples = new Float32Array(Math.round((lead + body + tail) * rate))
    const from = Math.round(lead * rate)
    const to = from + Math.round(body * rate)
    for (let i = from; i < to; i++) samples[i] = level * Math.sin((2 * Math.PI * 200 * i) / rate)
    return { samples, from, to }
  }

  it('cuts the silence before and after, from 8 ms before the first 5 ms frame that sounds, to 50 ms after', () => {
    const { samples, from, to } = take(0.4, 0.3, 0.6)
    const span = soundingSpan(samples, rate)
    // The first 10 ms frame (5 ms apart) to reach the burst starts up to 10 ms before it.
    expect(from - span.start).toBeGreaterThanOrEqual(0.008 * rate)
    expect(from - span.start).toBeLessThanOrEqual(0.018 * rate)
    expect(span.end).toBe(to + 2_400)
  })

  it('starts a noisy take’s Pad at its fart, not at the room noise before it (#298)', async () => {
    const golden = goldenRecordings.find(g => g.id === '106')
    if (!golden) throw new Error('fixture 106')
    const { samples, sampleRate } = await decoded(golden)
    const { start, end } = soundingSpan(samples, sampleRate)
    // The owner's phone take: its fart runs from 2.262 s to 2.454 s, after 2 s of room noise with
    // bumps within 30 dB of its loudest. Until #298 its Pad started at 0.28 s, 1.98 s early.
    const early = golden.gesture.start_s - start / sampleRate
    expect(early).toBeGreaterThanOrEqual(0)
    expect(early).toBeLessThan(0.05)
    expect(end / sampleRate).toBeGreaterThanOrEqual(golden.gesture.end_s)
  })

  /** A burst at `level` from 0.2 s to 0.4 s, silence, then a 0.5 burst from 0.7 s to 1.0 s. */
  function twoBursts(level: number) {
    const samples = new Float32Array(Math.round(1.3 * rate))
    const loud = take(0.7, 0.3, 0.3)
    samples.set(loud.samples)
    samples.set(take(0.2, 0.2, 0, level).samples)
    return { samples, loud }
  }

  it('cuts a first fart more than 12 dB under the loudest, past a 50 ms gap, as a Song does (#298)', () => {
    // −18 dB, 0.3 s before the loud burst: not the attack, and not joined to it.
    const { samples, loud } = twoBursts(0.5 * 10 ** (-18 / 20))
    const span = soundingSpan(samples, rate)
    expect(span.start).toBe(soundingSpan(loud.samples, rate).start)
    expect(span.start / rate).toBeGreaterThan(0.68)
    expect(span.end).toBe(loud.to + 2_400)
  })

  it('keeps a first fart within 12 dB of the loudest: the attack is its own', () => {
    const level = 0.5 * 10 ** (-3 / 20)
    const { samples, loud } = twoBursts(level)
    const span = soundingSpan(samples, rate)
    expect(span.start).toBe(soundingSpan(take(0.2, 0.2, 0, level).samples, rate).start)
    expect(span.start / rate).toBeLessThan(0.2)
    expect(span.end).toBe(loud.to + 2_400)
  })

  it('keeps a second, quieter fart', () => {
    const first = take(0.2, 0.2, 0.3)
    const second = take(0, 0.2, 0.2, 0.1)
    const samples = new Float32Array(first.samples.length + second.samples.length)
    samples.set(first.samples)
    samples.set(second.samples, first.samples.length)
    expect(soundingSpan(samples, rate).end).toBe(first.samples.length + second.to + 2_400)
  })

  it('keeps a silent take whole', () => {
    expect(soundingSpan(new Float32Array(rate), rate)).toEqual({ start: 0, end: rate })
  })

  it('starts every fixture’s Pad where a Song starts its fart, and keeps the rest of its sound', async () => {
    const lessThanAll: string[] = []
    for (const golden of goldenRecordings) {
      const { samples, sampleRate } = await decoded(golden)
      const { start, end } = soundingSpan(samples, sampleRate)
      const at = `fixture ${golden.id}`
      // The reference's lead_in_start() (#287), at the take's own rate: the gesture's start, or its
      // quiet lead-in before that.
      const leadIn = Math.round((golden.gesture.lead_start_sample * sampleRate) / 44_100)
      expect(start, at).toBe(leadIn)
      // Recording Analysis' gesture's end, to the 10 ms window.
      expect(end / sampleRate, at).toBeGreaterThanOrEqual(golden.gesture.end_s - 0.01)
      let all = 0
      let kept = 0
      samples.forEach((s, i) => {
        all += s * s
        if (i >= start && i < end) kept += s * s
      })
      if (kept / all < 0.999) lessThanAll.push(golden.id)
    }
    // Every fixture keeps 99.9% of its energy or more, but where its Pad leaves out what a Song
    // leaves out before the fart (#298). `013` (99.69%) and `022` (98.16%) start 0.25 s before
    // their attack, the longest lead-in, so 0.06 s and 0.38 s of their quiet sound go: it sits at
    // their own noise floor (ADR 0016, Room noise). The owner's phone takes `106` (98.74%), `107`
    // (99.76%), `108` (99.67%) and `109` (99.81%) leave out the room noise before their fart, past
    // 0.5 to 1.5 s of quiet: 1.98 s, 1.14 s, 0.55 s and 0.60 s more than before.
    expect(lessThanAll).toEqual(['013', '022', '106', '107', '108', '109'])
  })
})

describe('padGain', () => {
  it('puts the loudest sample, on any channel, at 0.5 (−6 dBFS)', () => {
    expect(PAD_PEAK).toBe(0.5)
    expect(padGain([Float32Array.of(0.1, -0.25), Float32Array.of(0.2, 0)])).toBe(2)
    expect(padGain([Float32Array.of(0.5, -1)])).toBe(0.5)
  })

  it('leaves a silent sound as it is', () => {
    expect(padGain([new Float32Array(10)])).toBe(1)
    expect(padGain([])).toBe(1)
  })
})

describe('padSound', () => {
  it('plays the span at one gain, with only the 3 ms fade in and 30 ms fade out', async () => {
    const golden = goldenRecordings.find(g => g.id === '098')
    if (!golden) throw new Error('fixture 098')
    const { samples, sampleRate } = await decoded(golden)
    const { start, end } = soundingSpan(samples, sampleRate)
    const [sound] = padSound([samples], sampleRate)
    expect(sound).toHaveLength(end - start)
    const fadeIn = Math.round(0.003 * sampleRate)
    const fadeOut = Math.round(0.03 * sampleRate)
    expect(sound[0]).toBe(0)
    expect(sound.at(-1)).toBe(0)
    // Between the fades, every sample is the take's own times one gain: no pitch or speed change.
    const gain = padGain([padSoundUngained(samples, start, end, fadeIn, fadeOut)])
    expect(gain).not.toBe(1)
    let worst = 0
    sound.subarray(fadeIn, sound.length - fadeOut).forEach((s, i) => {
      worst = Math.max(worst, Math.abs(s - samples[start + fadeIn + i] * gain))
    })
    expect(worst).toBeLessThan(1e-6)
    sound.subarray(0, fadeIn).forEach((s, i) => {
      expect(Math.abs(s)).toBeLessThanOrEqual(Math.abs(samples[start + i] * gain) + 1e-6)
    })
  })

  it('peaks every fixture at 0.5, so no two Pads at once go past full scale', async () => {
    const sounds = await Promise.all(
      goldenRecordings.map(async golden => {
        const { samples, sampleRate } = await decoded(golden)
        return padSound([samples], sampleRate)[0]
      })
    )
    for (const sound of sounds) expect(peakOf(sound)).toBeCloseTo(PAD_PEAK, 6)
    let loudest = 0
    sounds.forEach((first, a) => {
      for (const second of sounds.slice(a + 1)) {
        const n = Math.min(first.length, second.length)
        for (let i = 0; i < n; i++) loudest = Math.max(loudest, Math.abs(first[i] + second[i]))
      }
    })
    expect(loudest).toBeGreaterThan(0.5)
    expect(loudest).toBeLessThanOrEqual(1)
  })

  it('cuts each channel at the same span, read on their mix', () => {
    const left = new Float32Array(48_000)
    const right = new Float32Array(48_000)
    for (let i = 24_000; i < 28_800; i++) right[i] = 0.5
    const [l, r] = padSound([left, right], 48_000)
    const { start, end } = soundingSpan(
      right.map(s => s / 2),
      48_000
    )
    expect(l).toHaveLength(r.length)
    expect(r.length).toBe(end - start)
    expect(end).toBe(28_800 + 2_400)
    expect(l.every(s => s === 0)).toBe(true)
  })
})

function peakOf(samples: Float32Array): number {
  let peak = 0
  for (const s of samples) peak = Math.max(peak, Math.abs(s))
  return peak
}

/** The span with the fades and no gain: what `padGain` levels. */
function padSoundUngained(
  samples: Float32Array,
  start: number,
  end: number,
  fadeIn: number,
  fadeOut: number
): Float32Array {
  const out = samples.slice(start, end)
  for (let i = 0; i < fadeIn; i++) out[i] *= i / fadeIn
  for (let i = 0; i < fadeOut; i++) out[out.length - 1 - i] *= i / fadeOut
  return out
}
