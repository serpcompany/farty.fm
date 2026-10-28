import { beforeAll, describe, expect, it } from 'vitest'
import {
  autoMapInputs,
  goldenArrangement,
  goldenRecording,
  goldenSong,
  libraries,
  songIds,
  storedAnalysis
} from '@/test-support/engine-golden'
import { decoded, type GoldenRecording, gestureBody, goldenIndex, row } from '@/test-support/golden'
import { arrange } from './auto-map'
import { renderFromRecordings, renderSong } from './render-song'
import { renderSource } from './render-source'
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
  return { gesture: await gestureBody(g) }
}

const round = (x: number, digits: number) => Number(x.toFixed(digits))

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
        songGain = Math.max(songGain, Math.abs(mine.gainDb - g.render.gain_db))
      }
      const goldenGainRounding = 0.05
      expect(songGain, id).toBeLessThanOrEqual(goldenGainRounding + 1e-9)
      worstGain = Math.max(worstGain, songGain)

      let peak = 0
      for (const s of rendered.samples) {
        expect(Number.isFinite(s)).toBe(true)
        peak = Math.max(peak, Math.abs(s))
      }
      expect(peak).toBeCloseTo(0.89, 6)
      lines.push(row(id, song.notes.length, songGain.toFixed(3), ms.toFixed(0)))
    })
  }

  it('reports', () => {
    console.log(`${lines.join('\n')}\nworst |Δgain| ${worstGain.toFixed(3)} dB`)
  })
})

describe('the render path from what the app stores', () => {
  it('cuts the golden gesture, a Noise-like one too, for a fart placed by ear (ADR 0015)', async () => {
    const noiseLike = ['009', '080']
    for (const id of noiseLike) expect(goldenRecording(id).recording_pitch_midi, id).toBeNull()
    for (const id of [...goldenIndex.melodic_recordings, ...noiseLike]) {
      const g = goldenRecording(id)
      const file = await decoded(g)
      const source = renderSource(
        { samples: file.samples, sampleRate: file.sampleRate },
        storedAnalysis(g)
      )
      expect(source.gesture, id).toEqual(await gestureBody(g))
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
    expect(() => renderSong(song, locked, sources)).toThrow(/locked: 3 of 6 notes covered/)
    const unlocked = arrange(song, library)
    expect(() => renderSong(song, unlocked, new Map())).toThrow(/No Recording plays pitch/)
  })
})

describe('fart-only rendering (ADR 0004), raw (ADR 0012)', () => {
  const silent: RenderSource = { gesture: new Float64Array(44100) }

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

    const expected = new Float64Array(out.samples.length)
    const segment = source.gesture.slice(0, placed.lengthSamples)
    applyFades(segment)
    const gain = 10 ** (placed.gainDb / 20)
    for (let i = 0; i < segment.length; i++) expected[22050 + i] += segment[i] * gain
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

    const segment = source.gesture.slice(0, placed.lengthSamples)
    applyFades(segment)
    const gain = 10 ** (placed.gainDb / 20)
    const expected = new Float64Array(length)
    for (let i = placed.startSample; i < length; i++) {
      expected[i] += segment[i - placed.startSample] * gain
    }
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
