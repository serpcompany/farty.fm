import { beforeAll, describe, expect, it } from 'vitest'
import {
  autoMapInput,
  autoMapInputs,
  goldenArrangement,
  goldenRecording,
  goldenSong,
  libraries,
  songIds,
  storedAnalysis
} from '@/test-support/engine-golden'
import {
  decoded,
  type GoldenRecording,
  gestureBody,
  goldenIndex,
  leadInBody,
  row
} from '@/test-support/golden'
import { arrange, placedAutoMapRecording } from './auto-map'
import { renderFromRecordings, renderSong } from './render-song'
import { leadInStart, renderSource } from './render-source'
import {
  applyFades,
  limit,
  noteInBeats,
  RENDER_SAMPLE_RATE,
  type RenderSource,
  render,
  songSeconds
} from './renderer'

const SR = RENDER_SAMPLE_RATE
const library = autoMapInputs(libraries.full)
const sources = new Map<string, RenderSource>()

async function goldenSource(g: GoldenRecording): Promise<RenderSource> {
  return { gesture: await gestureBody(g), leadIn: await leadInBody(g) }
}

const round = (x: number, digits: number) => Number(x.toFixed(digits))

function withLeadIn(
  source: RenderSource,
  placed: { leadSamples: number; lengthSamples: number }
): Float64Array {
  const segment = new Float64Array(placed.leadSamples + placed.lengthSamples)
  segment.set(source.leadIn.subarray(source.leadIn.length - placed.leadSamples))
  segment.set(source.gesture.subarray(0, placed.lengthSamples), placed.leadSamples)
  applyFades(segment, placed.lengthSamples)
  return segment
}

beforeAll(async () => {
  for (const id of goldenIndex.melodic_recordings) {
    sources.set(id, await goldenSource(goldenRecording(id)))
  }
})

describe('the renderer places every note as the reference does', () => {
  const lines: string[] = [row('song', 'notes', 'max |Δgain|', 'render ms')]
  let worstGain = 0

  for (const id of songIds) {
    it(id, () => {
      const song = goldenSong(id)
      const golden = goldenArrangement('full', id)
      const arrangement = arrange(song, library)
      if (!golden.unlocked) {
        expect(arrangement.unlocked, id).toBe(false)
        expect(() => renderSong(song, arrangement, sources)).toThrow(/locked/)
        return
      }
      const started = performance.now()
      const rendered = renderSong(song, arrangement, sources)
      const ms = performance.now() - started

      expect(rendered.sampleRate).toBe(44100)
      expect(rendered.samples.length).toBe(
        Math.trunc((songSeconds(song.length_beats, song.bpm) + 1) * SR)
      )
      expect(golden.notes).toHaveLength(song.notes.length)
      let songGain = 0
      for (const g of golden.notes ?? []) {
        const mine = rendered.notes[g.index]
        const label = `${id} note ${g.index}`
        expect(mine.noteIndex, label).toBe(g.index)
        expect(mine.recordingId, label).toBe(g.recording)
        expect(mine.targetMidi, label).toBe(g.target_midi)
        expect(round(mine.startSample / SR, 3), label).toBe(g.render.start_s)
        expect(round(mine.lengthSamples / SR, 3), label).toBe(g.render.len_s)
        expect(round(mine.leadSamples / SR, 3), label).toBe(g.render.lead_s)
        songGain = Math.max(songGain, Math.abs(mine.gainDb - g.render.gain_db))
      }
      const goldenGainRounding = 0.05
      expect(songGain, id).toBeLessThanOrEqual(goldenGainRounding + 1e-9)
      worstGain = Math.max(worstGain, songGain)

      let peak = 0
      let notFinite = 0
      for (const s of rendered.samples) {
        if (!Number.isFinite(s)) notFinite++
        else peak = Math.max(peak, Math.abs(s))
      }
      expect(notFinite, id).toBe(0)
      expect(peak).toBeCloseTo(0.89, 6)
      lines.push(row(id, song.notes.length, songGain.toFixed(3), ms.toFixed(0)))
    })
  }

  it('reports', () => {
    console.log(`${lines.join('\n')}\nworst |Δgain| ${worstGain.toFixed(3)} dB`)
  })
})

describe('the render path from what the app stores', () => {
  it('cuts the golden gesture and its lead-in, a Noise-like one too, for a fart placed by ear (ADR 0015)', async () => {
    const noiseLike = goldenIndex.recordings.filter(
      id => !goldenIndex.melodic_recordings.includes(id)
    )
    expect(noiseLike).toEqual(
      expect.arrayContaining(['065', '081', '105', '106', '107', '108', '109', '110'])
    )
    for (const id of noiseLike) expect(goldenRecording(id).recording_pitch_midi, id).toBeNull()
    for (const id of [...goldenIndex.melodic_recordings, ...noiseLike]) {
      const g = goldenRecording(id)
      const file = await decoded(g)
      const source = renderSource(
        { samples: file.samples, sampleRate: file.sampleRate },
        storedAnalysis(g)
      )
      expect(source.gesture, id).toEqual(await gestureBody(g))
      expect(source.leadIn, id).toEqual(await leadInBody(g))
    }
  })

  it('renders the same audio from stored Recordings as from the golden inputs', async () => {
    const song = goldenSong('twinkle')
    const arrangement = arrange(song, library)
    const recordings = await Promise.all(
      libraries.full.map(async id => {
        const g = goldenRecording(id)
        const file = await decoded(g)
        return {
          id,
          audio: { samples: file.samples, sampleRate: file.sampleRate },
          analysis: storedAnalysis(g)
        }
      })
    )
    const fromStore = renderFromRecordings(song, arrangement, recordings)
    const fromGolden = renderSong(song, arrangement, sources)
    expect(fromStore.notes).toEqual(fromGolden.notes)
    let maxDiff = 0
    for (let i = 0; i < fromStore.samples.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(fromStore.samples[i] - fromGolden.samples[i]))
    }
    expect(maxDiff).toBe(0)
  })

  it('refuses a locked Song, and a Recording it was not given', () => {
    const song = goldenSong('twinkle')
    const locked = arrange(song, autoMapInputs(libraries.small))
    expect(() => renderSong(song, locked, sources)).toThrow(/locked: 4 of 6 notes covered/)
    const unlocked = arrange(song, library)
    expect(() => renderSong(song, unlocked, new Map())).toThrow(/No Recording plays pitch/)
  })
})

describe('fart-only rendering (ADR 0004), raw (ADR 0012)', () => {
  const silent: RenderSource = { gesture: new Float64Array(44100), leadIn: new Float64Array(4410) }

  it('renders silence from silent Recordings', () => {
    const notes = [0, 1, 2, 3].map(beat =>
      noteInBeats(silent, 62, { start: beat, dur: 1, bpm: 60, barLines: [0] })
    )
    const out = render(notes, 4)
    expect(out.samples).toHaveLength(5 * 44100)
    expect(out.samples.every(s => s === 0)).toBe(true)
  })

  it('plays a note as its Recording, trimmed, faded and scaled, whatever the note', () => {
    const g = goldenRecording('013')
    const source = sources.get('013') as RenderSource
    const at = (targetMidi: number) =>
      render([noteInBeats(source, targetMidi, { start: 1, dur: 1, bpm: 120, barLines: [0] })], 2)
    const out = at(g.recording_pitch_midi as number)
    const placed = out.notes[0]
    expect(placed.startSample).toBe(22050)
    expect(placed.lengthSamples).toBe(Math.trunc(0.475 * SR))
    expect(placed.leadSamples).toBe(source.leadIn.length)
    expect(source.leadIn.length).toBe(11025)

    const expected = new Float64Array(out.samples.length)
    const segment = withLeadIn(source, placed)
    const gain = 10 ** (placed.gainDb / 20)
    for (let i = 0; i < segment.length; i++) {
      expected[22050 - placed.leadSamples + i] += segment[i] * gain
    }
    expect(out.samples).toEqual(limit(expected))
    expect(at((g.recording_pitch_midi as number) + 3)).toEqual(out)
    expect(at((g.recording_pitch_midi as number) - 12)).toEqual(out)
  })

  it('plays a fart shorter than its note whole, unstretched, then leaves the rest silent', () => {
    const source = sources.get('016') as RenderSource
    const out = render([noteInBeats(source, 40, { start: 0, dur: 2, bpm: 120, barLines: [0] })], 1)
    const placed = out.notes[0]
    expect(placed.lengthSamples).toBe(source.gesture.length)
    expect(out.samples.subarray(placed.lengthSamples).every(s => s === 0)).toBe(true)
  })

  it("accents notes on the score's bar lines by 1.5 dB, not a pickup", () => {
    const source = sources.get('002') as RenderSource
    const happyBirthdayAfterItsPickup = [1, 4, 7]
    const beats = (start: number) => ({
      start,
      dur: 1,
      bpm: 90,
      barLines: happyBirthdayAfterItsPickup
    })
    const notes = [0, 0.75, 1, 2, 4, 5.5, 7 + 1e-9].map(start =>
      noteInBeats(source, 48, beats(start))
    )
    expect(notes.map(n => n.downbeat)).toEqual([false, false, true, false, true, false, true])
    const out = render(notes, 9)
    expect(out.notes[2].gainDb - out.notes[0].gainDb).toBeCloseTo(1.5, 12)
  })

  it('keeps notes at least 60 ms long and fades them in and out', () => {
    const source = sources.get('059') as RenderSource
    const out = render(
      [noteInBeats(source, 67, { start: 0, dur: 0.05, bpm: 120, barLines: [0] })],
      1
    )
    expect(out.notes[0].lengthSamples).toBe(Math.trunc(0.06 * SR))
    const fadeInStart = out.samples[0]
    const fadeOutEnd = out.samples[out.notes[0].lengthSamples - 1]
    expect(fadeInStart).toBe(0)
    expect(fadeOutEnd).toBe(0)
  })
})

describe("a fart's lead-in", () => {
  const fart = (leadSeconds: number, bodySeconds: number): RenderSource => ({
    gesture: new Float64Array(Math.trunc(bodySeconds * SR)).fill(0.5),
    leadIn: new Float64Array(Math.trunc(leadSeconds * SR)).fill(0.02)
  })
  const at = (seconds: number) => Math.trunc(seconds * SR)

  const a = fart(0.3, 0.5)
  const b = fart(0.3, 2)
  const notes = (
    [
      [0.1, 0.5, a],
      [1.1, 1, a],
      [2.1, 0.8, b],
      [3.1, 1, a]
    ] as const
  ).map(([start, dur, source]) => noteInBeats(source, 60, { start, dur, bpm: 60, barLines: [] }))
  const out = render(notes, 5)

  it('plays in the rest before the beat, never in the gap after a note nor before the start', () => {
    expect(out.notes.map(n => round(n.leadSamples / SR, 3))).toEqual([0.1, 0.3, 0, 0.2])
    expect(out.samples.subarray(at(0.58), at(0.79)).every(s => s === 0)).toBe(true)
    expect(out.samples.subarray(at(2.076), at(2.1)).every(s => s === 0)).toBe(true)
    for (const n of out.notes) {
      if (n.leadSamples > 0) expect(out.samples[n.startSample - n.leadSamples + 200]).not.toBe(0)
    }
  })

  it("lands every note's attack on its beat", () => {
    const fadeIn = Math.trunc(0.003 * SR)
    for (const [i, n] of out.notes.entries()) {
      expect(n.startSample, `note ${i}`).toBe(at(notes[i].startSeconds))
      const level = Math.abs(out.samples[n.startSample + 500])
      let first = n.startSample - n.leadSamples
      while (Math.abs(out.samples[first]) < 0.5 * level) first++
      if (n.leadSamples > 0) expect(first, `note ${i}`).toBe(n.startSample)
      else expect(first - n.startSample, `note ${i}`).toBeLessThanOrEqual(fadeIn)
    }
  })

  it('places notes given out of start order the same, and returns them in the order given', () => {
    const order = [3, 1, 0, 2]
    const shuffled = render(
      order.map(i => notes[i]),
      5
    )
    expect(shuffled.notes).toEqual(order.map(i => out.notes[i]))
    expect(shuffled.samples).toEqual(out.samples)
  })

  it('holds the next lead-in back until a fart played past its written end stops', () => {
    const short = render(
      (
        [
          [1, 0.05],
          [1.3, 1]
        ] as const
      ).map(([start, dur]) => noteInBeats(a, 60, { start, dur, bpm: 60, barLines: [] })),
      3
    )
    const playedEnd = at(1) + at(0.06)
    expect(playedEnd).toBeGreaterThan(at(1.05))
    expect(short.notes[0].lengthSamples).toBe(at(0.06))
    expect(short.notes[1].leadSamples).toBe(at(1.3) - playedEnd)
    expect(round(short.notes[1].leadSamples / SR, 3)).toBe(0.24)
    expect(short.samples[playedEnd + 200]).not.toBe(0)
    expect(short.samples[playedEnd - 1]).toBe(0)
  })

  it('sets the level from the attack, not the quiet lead-in', () => {
    const alone = render(
      [noteInBeats(fart(0, 0.5), 60, { start: 1, dur: 1, bpm: 60, barLines: [] })],
      2
    )
    expect(Math.abs(out.notes[1].gainDb - alone.notes[0].gainDb)).toBeLessThan(0.1)
  })

  it("plays 009's G3 opening before its beat when placed by ear on G3", async () => {
    const song = goldenSong('saints')
    const g009 = goldenRecording('009')
    const placed = libraries.full
      .filter(id => !['002', '032', '022'].includes(id))
      .map(id =>
        id === '009' ? placedAutoMapRecording(id, storedAnalysis(g009), 55) : autoMapInput(id)
      )
    const arrangement = arrange(song, placed)
    expect(arrangement.unlocked).toBe(true)
    const recordings = await Promise.all(
      placed.map(async r => {
        const g = goldenRecording(r.id)
        const file = await decoded(g)
        const audio = { samples: file.samples, sampleRate: file.sampleRate }
        return { id: r.id, audio, analysis: storedAnalysis(g) }
      })
    )
    const rendered = renderFromRecordings(song, arrangement, recordings)
    const first = rendered.notes[0]
    expect(first.recordingId).toBe('009')
    expect(first.startSample).toBe(at(0.2))
    expect(first.leadSamples).toBe(first.startSample)

    const leadIn = await leadInBody(g009)
    expect(leadIn.length).toBe(9460)
    const heard = rendered.samples.subarray(0, first.startSample)
    const played = leadIn.subarray(leadIn.length - first.leadSamples)
    expect(correlation(heard.subarray(200), played.subarray(200))).toBeGreaterThan(0.999)
    const body = (await gestureBody(g009)).subarray(0, 4410)
    const attack = rendered.samples.subarray(first.startSample, first.startSample + 4410)
    expect(correlation(attack, body)).toBeGreaterThan(0.99)
  })
})

describe('where a lead-in starts', () => {
  const take = (...parts: [number, number][]) => {
    const y = new Float32Array(parts.reduce((n, [s]) => n + Math.trunc(s * SR), 0))
    let i = 0
    for (const [s, level] of parts) {
      y.fill(level, i, i + Math.trunc(s * SR))
      i += Math.trunc(s * SR)
    }
    return y
  }
  const frame = Math.trunc(0.005 * SR)
  const before = Math.trunc(0.008 * SR)

  it('takes a quiet sound before the attack, from 8 ms before it', () => {
    const y = take([0.1, 0], [0.2, 0.05], [0.5, 0.5])
    const attack = Math.trunc(0.3 * SR) - before
    expect(Math.abs(leadInStart(y, attack) - (Math.trunc(0.1 * SR) - before))).toBeLessThan(frame)
  })

  it('takes a frame at most when the fart opens loud', () => {
    const attack = Math.trunc(0.1 * SR) - before
    expect(attack - leadInStart(take([0.1, 0], [0.5, 0.5]), attack)).toBeLessThanOrEqual(frame)
  })

  it('keeps a gap of up to 50 ms inside it', () => {
    const y = take([0.1, 0], [0.1, 0.05], [0.03, 0.001], [0.05, 0.05], [0.5, 0.5])
    const attack = Math.trunc(0.28 * SR) - before
    expect(Math.abs(leadInStart(y, attack) - (Math.trunc(0.1 * SR) - before))).toBeLessThan(frame)
  })

  it('leaves out room noise before a longer gap', () => {
    const y = take([1, 0.005], [0.1, 0.05], [0.3, 0.005], [0.5, 0.5])
    const attack = Math.trunc(1.4 * SR) - before
    expect(attack - leadInStart(y, attack)).toBeLessThanOrEqual(frame)
  })

  it('is at most a quarter second', () => {
    const attack = SR - before
    expect(attack - leadInStart(take([1, 0.05], [0.5, 0.5]), attack)).toBe(Math.trunc(0.25 * SR))
  })
})

function correlation(x: ArrayLike<number>, y: ArrayLike<number>): number {
  const n = Math.min(x.length, y.length)
  let mx = 0
  let my = 0
  for (let i = 0; i < n; i++) {
    mx += x[i] / n
    my += y[i] / n
  }
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my)
    sxx += (x[i] - mx) ** 2
    syy += (y[i] - my) ** 2
  }
  return sxy / Math.sqrt(sxx * syy)
}

describe('where the reference would fail, as the Swift port did, on synthetic placements no golden Song reaches', () => {
  it('clips a note that runs past the end of the mix', () => {
    const source = sources.get('013') as RenderSource
    const note = {
      source,
      targetMidi: 55,
      startSeconds: 1.9,
      lengthSeconds: 0.5,
      downbeat: false
    }
    const out = render([note], 1)
    const length = 2 * SR
    const placed = out.notes[0]
    expect(out.samples).toHaveLength(length)
    expect(placed.startSample + placed.lengthSamples).toBeGreaterThan(length)

    const segment = withLeadIn(source, placed)
    const gain = 10 ** (placed.gainDb / 20)
    const expected = new Float64Array(length)
    const from = placed.startSample - placed.leadSamples
    for (let i = from; i < length; i++) expected[i] += segment[i - from] * gain
    const lastSample = expected[length - 1]
    expect(lastSample).not.toBe(0)
    expect(out.samples).toEqual(limit(expected))
  })

  it('clamps the fades on a segment shorter than the 3 ms fade-in: all 50 samples fade in, and a third fade out', () => {
    const n = 50
    const segment = new Float64Array(n).fill(1)
    applyFades(segment)
    const fadeOut = 16
    const expected = Array.from({ length: n }, (_, i) => {
      const fadeIn = i / (n - 1)
      const j = i - (n - fadeOut)
      const ramp = j < 0 ? 1 : 1 - j / (fadeOut - 1)
      return fadeIn * ramp * ramp
    })
    for (let i = 0; i < n; i++) expect(segment[i], `sample ${i}`).toBeCloseTo(expected[i], 12)
    expect(segment[0]).toBe(0)
    expect(segment[n - 1]).toBe(0)
  })
})
