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
import {
  CONTOUR_TOLERANCE_MIDI,
  compareContour,
  decoded,
  type GoldenRecording,
  gestureBody,
  goldenContourHz,
  goldenIndex,
  row
} from '@/test-support/golden'
import { hzToMidi } from '../analysis/numeric'
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

// The renderer on the golden inputs (gesture, contour and Recording Pitch from fixtures/golden),
// checked against the reference's own placement of every note of the 13 unlocked Arrangements.
// The audio itself is measured with the reference's evaluate() by
// tools/melody-lab/evaluate_renders.py on the renders of scripts/render-songs.ts.

const SR = RENDER_SAMPLE_RATE
const library = libraries.full.map(autoMapInput)
const sources = new Map<string, RenderSource>()

async function goldenSource(g: GoldenRecording): Promise<RenderSource> {
  return {
    gesture: await gestureBody(g),
    pitchContourHz: goldenContourHz(g),
    recordingPitchMidi: g.recording_pitch_midi as number
  }
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
        expect(mine.shiftSemitones, label).toBe(g.shift_semitones)
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
  it('cuts the golden gesture and recomputes the golden contour', async () => {
    for (const id of goldenIndex.melodic_recordings) {
      const g = goldenRecording(id)
      const file = await decoded(g)
      const source = renderSource(
        { samples: file.samples, sampleRate: file.sampleRate },
        storedAnalysis(g)
      )
      expect(source.gesture, id).toEqual(await gestureBody(g))
      expect(source.recordingPitchMidi).toBe(g.recording_pitch_midi)
      const midi = Array.from(source.pitchContourHz, f => (Number.isFinite(f) ? hzToMidi(f) : null))
      const agreement = compareContour(midi, g)
      expect(midi.length, id).toBe(g.pitch_contour.frames)
      expect(agreement.voicingAgrees, id).toBe(g.pitch_contour.frames)
      expect(agreement.maxDiffMidi, id).toBeLessThanOrEqual(CONTOUR_TOLERANCE_MIDI)
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
    expect(() => renderSong(song, locked, sources)).toThrow(/locked: 5 of 6 notes covered/)
    const unlocked = arrange(song, library)
    expect(() => renderSong(song, unlocked, new Map())).toThrow(/No Recording plays pitch/)
  })

  it('refuses a Noise-like Recording as a source', () => {
    const g = goldenRecording('009')
    expect(() =>
      renderSource({ samples: new Float32Array(44100), sampleRate: 44100 }, storedAnalysis(g))
    ).toThrow(/Melodic/)
  })
})

describe('fart-only rendering (ADR 0004)', () => {
  const silent: RenderSource = {
    gesture: new Float64Array(44100),
    pitchContourHz: new Float64Array(172).fill(Number.NaN),
    recordingPitchMidi: 60
  }

  it('renders silence from silent Recordings', () => {
    const notes = [0, 1, 2, 3].map(beat =>
      noteInBeats(silent, 62, { start: beat, dur: 1, bpm: 60, beatsPerBar: 4 })
    )
    const out = render(notes, 4)
    expect(out.samples).toHaveLength(5 * 44100)
    expect(out.samples.every(s => s === 0)).toBe(true)
  })

  it('plays a note at its own pitch as the Recording, trimmed, faded and scaled', () => {
    // An empty contour leaves nothing to tune, and a shift of 0 reads every sample in place.
    const g = goldenRecording('013')
    const own = sources.get('013') as RenderSource
    const source = {
      ...own,
      pitchContourHz: new Float64Array(own.pitchContourHz.length).fill(Number.NaN)
    }
    const note = noteInBeats(source, g.recording_pitch_midi as number, {
      start: 1,
      dur: 1,
      bpm: 120,
      beatsPerBar: 4
    })
    const out = render([note], 2)
    const placed = out.notes[0]
    expect(placed.shiftSemitones).toBe(0)
    expect(placed.startSample).toBe(22050)
    expect(placed.lengthSamples).toBe(Math.trunc(0.475 * SR))

    const expected = new Float64Array(out.samples.length)
    const segment = source.gesture.slice(0, placed.lengthSamples)
    applyFades(segment)
    const gain = 10 ** (placed.gainDb / 20)
    for (let i = 0; i < segment.length; i++) expected[22050 + i] += segment[i] * gain
    expect(out.samples).toEqual(limit(expected))
  })

  it('accents downbeats by 1.5 dB, in any meter', () => {
    const source = sources.get('002') as RenderSource
    const beats = (start: number) => ({ start, dur: 1, bpm: 90, beatsPerBar: 3 })
    const notes = [0, 1, 3, 4.5, 6 + 1e-9].map(start => noteInBeats(source, 48, beats(start)))
    expect(notes.map(n => n.downbeat)).toEqual([true, false, true, false, true])
    const out = render(notes, 9)
    expect(out.notes[0].gainDb - out.notes[1].gainDb).toBeCloseTo(1.5, 12)
  })

  it('keeps notes at least 60 ms long and fades them in and out', () => {
    const source = sources.get('059') as RenderSource
    const out = render(
      [noteInBeats(source, 67, { start: 0, dur: 0.05, bpm: 120, beatsPerBar: 4 })],
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
    // At its own pitch with an empty contour, the note is the Recording trimmed, faded and scaled.
    const own = sources.get('013') as RenderSource
    const source = {
      ...own,
      pitchContourHz: new Float64Array(own.pitchContourHz.length).fill(Number.NaN)
    }
    const note = {
      source,
      targetMidi: own.recordingPitchMidi,
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
