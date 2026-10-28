import { beforeAll, describe, expect, it } from 'vitest'
import type { Analysis } from '@/lib/recordings'
import {
  autoMapInput,
  goldenArrangement,
  goldenRecording,
  goldenSong,
  libraries,
  songIds
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

// The renderer on the golden inputs (each gesture from fixtures/golden), checked against the
// reference's own placement of every note of the 9 unlocked Arrangements.
// The audio itself is measured with the reference's evaluate() by
// tools/melody-lab/evaluate_renders.py on the renders of scripts/render-songs.ts.

const SR = RENDER_SAMPLE_RATE
const library = libraries.full.map(autoMapInput)
const sources = new Map<string, RenderSource>()

async function goldenSource(g: GoldenRecording): Promise<RenderSource> {
  return { gesture: await gestureBody(g) }
}

/** The analysis the app would store for a fixture, from the golden bounds. */
function storedAnalysis(g: GoldenRecording): Analysis {
  return {
    gestureStartSeconds: g.gesture.start_sample / SR,
    gestureEndSeconds: g.gesture.end_sample / SR,
    cutAtReattack: g.gesture.cut_at_reattack,
    pitchEstimateMidi: g.pitch_estimate_midi,
    pitchConfidence: g.pitch_confidence,
    recordingPitchMidi: g.recording_pitch_midi,
    shortestNoteSeconds: g.shortest_note_s,
    settleSeconds: g.settle_s
  }
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
        // A note longer than every fixture near its pitch (ADR 0011), played raw (ADR 0012).
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
      // gain_db is written to 0.1 dB, so it can't agree closer than 0.05.
      expect(songGain, id).toBeLessThanOrEqual(0.05 + 1e-9)
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
  it('cuts the golden gesture', async () => {
    for (const id of goldenIndex.melodic_recordings) {
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
    const locked = arrange(song, libraries.small.map(autoMapInput))
    expect(() => renderSong(song, locked, sources)).toThrow(/locked: 3 of 6 notes covered/)
    const unlocked = arrange(song, library)
    expect(() => renderSong(song, unlocked, new Map())).toThrow(/No Recording plays pitch/)
  })

  it('cuts a Noise-like gesture too, for a fart placed by ear (ADR 0015)', async () => {
    for (const id of ['009', '080']) {
      const g = goldenRecording(id)
      expect(g.recording_pitch_midi, id).toBeNull()
      const file = await decoded(g)
      const source = renderSource(
        { samples: file.samples, sampleRate: file.sampleRate },
        storedAnalysis(g)
      )
      expect(source.gesture, id).toEqual(await gestureBody(g))
    }
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
    // Three semitones up, or an Octave Move down: the same fart, at its own pitch and speed.
    expect(at((g.recording_pitch_midi as number) + 3)).toEqual(out)
    expect(at((g.recording_pitch_midi as number) - 12)).toEqual(out)
  })

  it('plays a fart shorter than its note whole, then leaves the rest silent', () => {
    // 016 lasts 0.31 s, less than a 0.975 s half note at 120 bpm: it is never stretched.
    const source = sources.get('016') as RenderSource
    const out = render([noteInBeats(source, 40, { start: 0, dur: 2, bpm: 120, barLines: [0] })], 1)
    const placed = out.notes[0]
    expect(placed.lengthSamples).toBe(source.gesture.length)
    expect(out.samples.subarray(placed.lengthSamples).every(s => s === 0)).toBe(true)
  })

  it("accents notes on the score's bar lines by 1.5 dB, not a pickup", () => {
    const source = sources.get('002') as RenderSource
    // Happy Birthday: "Hap-py" is a pickup, and 3/4 bars start on "birth" (beat 1) and "you" (4).
    const barLines = [1, 4, 7]
    const beats = (start: number) => ({ start, dur: 1, bpm: 90, barLines })
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
    expect(out.samples[0]).toBe(0) // the fade-in starts at silence
    expect(out.samples[out.notes[0].lengthSamples - 1]).toBe(0) // and the fade-out ends there
  })
})

// Two Swift behaviors kept where the reference would fail. No golden Song reaches them, so these
// use synthetic note placements.
describe('where the reference would fail', () => {
  it('clips a note that runs past the end of the mix', () => {
    // The note is the Recording trimmed, faded and scaled.
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
    expect(expected[length - 1]).not.toBe(0) // the note still plays in the last sample
    expect(out.samples).toEqual(limit(expected))
  })

  it('clamps the fades on a segment shorter than the 3 ms fade-in', () => {
    // 50 samples: the fade-in covers all 50 (not 132), and the fade-out a third of them, 16.
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
