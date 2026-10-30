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

// The renderer on the golden inputs (each gesture from fixtures/golden), checked against the
// reference's own placement of every note of the 9 unlocked Arrangements.
// The audio itself is measured with the reference's evaluate() by
// tools/melody-lab/evaluate_renders.py on the renders of scripts/render-songs.ts.

const SR = RENDER_SAMPLE_RATE
const library = libraries.full.map(autoMapInput)
const sources = new Map<string, RenderSource>()

async function goldenSource(g: GoldenRecording): Promise<RenderSource> {
  return { gesture: await gestureBody(g), leadIn: await leadInBody(g) }
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

/** A placed note's segment as the reference builds it: lead-in, then the gesture, faded. */
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
        expect(round(mine.leadSamples / SR, 3), label).toBe(g.render.lead_s)
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
    const locked = arrange(song, libraries.small.map(autoMapInput))
    expect(() => renderSong(song, locked, sources)).toThrow(/locked: 4 of 6 notes covered/)
    const unlocked = arrange(song, library)
    expect(() => renderSong(song, unlocked, new Map())).toThrow(/No Recording plays pitch/)
  })

  it('cuts a Noise-like gesture too, for a fart placed by ear (ADR 0015)', async () => {
    for (const id of ['065', '081']) {
      const g = goldenRecording(id)
      expect(g.recording_pitch_midi, id).toBeNull()
      const file = await decoded(g)
      const source = renderSource(
        { samples: file.samples, sampleRate: file.sampleRate },
        storedAnalysis(g)
      )
      expect(source.gesture, id).toEqual(await gestureBody(g))
      expect(source.leadIn, id).toEqual(await leadInBody(g))
    }
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
    // Its lead-in, whole: half a second before the beat has room for it (#287). The quiet sound
    // before 013's attack lasts 0.306 s, so it is cut to the longest lead-in, 0.25 s.
    expect(placed.leadSamples).toBe(source.leadIn.length)
    expect(source.leadIn.length).toBe(11025)

    const expected = new Float64Array(out.samples.length)
    const segment = withLeadIn(source, placed)
    const gain = 10 ** (placed.gainDb / 20)
    for (let i = 0; i < segment.length; i++) {
      expected[22050 - placed.leadSamples + i] += segment[i] * gain
    }
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

// A fart's quiet lead-in plays before its note's beat (#287), as the reference's
// tools/melody-lab/test_lead_in.py checks there.
describe("a fart's lead-in", () => {
  /** A fart that opens on a quiet `leadSeconds` lead-in, then holds 0.5 for `bodySeconds`. */
  const fart = (leadSeconds: number, bodySeconds: number): RenderSource => ({
    gesture: new Float64Array(Math.trunc(bodySeconds * SR)).fill(0.5),
    leadIn: new Float64Array(Math.trunc(leadSeconds * SR)).fill(0.02)
  })
  const at = (seconds: number) => Math.trunc(seconds * SR)

  // a: 0.5 s; b: 2 s, so it fills its note and leaves only the gap. Both open on 0.3 s of lead-in.
  // Note 0 starts 0.1 s in; a half-beat rest comes after it, none after note 1, 0.2 s after note 2.
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
    // Cut at the Song's start; all of it in a half-beat rest; none after a legato note; the 0.2 s
    // of a rest shorter than it.
    expect(out.notes.map(n => round(n.leadSamples / SR, 3))).toEqual([0.1, 0.3, 0, 0.2])
    // Nothing between note 0's end (0.575 s) and note 1's lead-in (0.8 s), and the gap after
    // note 1 (2.075 to 2.1 s) stays silent.
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

  it('sets the level from the attack, not the quiet lead-in', () => {
    // Read from the lead-in's start, its quiet 0.3 s would set the note 28 dB louder. Only the
    // 3 ms fade-in, now on the lead-in instead of the attack, moves it.
    const alone = render(
      [noteInBeats(fart(0, 0.5), 60, { start: 1, dur: 1, bpm: 60, barLines: [] })],
      2
    )
    expect(Math.abs(out.notes[1].gainDb - alone.notes[0].gainDb)).toBeLessThan(0.1)
  })

  it("plays 009's G3 opening before its beat when placed by ear on G3", async () => {
    // When the Saints: with 002, 032 and 022 gone, 009 placed on G3 plays the first note, which
    // starts on the half beat (0.2 s), so 0.2 s of its 0.215 s G3 opening plays before the beat.
    // The reference finds the same (tools/melody-lab/test_lead_in.py reads the G3 there).
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
    expect(first.leadSamples).toBe(first.startSample) // all the room there is, back to the start

    const leadIn = await leadInBody(g009)
    expect(leadIn.length).toBe(9460) // 0.215 s
    const heard = rendered.samples.subarray(0, first.startSample)
    const played = leadIn.subarray(leadIn.length - first.leadSamples)
    // The take's own samples, past the 3 ms fade-in, under the gentle limiter.
    expect(correlation(heard.subarray(200), played.subarray(200))).toBeGreaterThan(0.999)
    // And its attack on the beat: the gesture from there.
    const body = (await gestureBody(g009)).subarray(0, 4410)
    const attack = rendered.samples.subarray(first.startSample, first.startSample + 4410)
    expect(correlation(attack, body)).toBeGreaterThan(0.99)
  })
})

// The same takes as `LeadInStart` in tools/melody-lab/test_lead_in.py.
describe('where a lead-in starts', () => {
  /** A take of [seconds, level] stretches. */
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
  const before = Math.trunc(0.008 * SR) // the gesture starts this long before the attack

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
    // As on the owner's phone takes (#295): a bump of room noise 20 dB down, then 0.3 s of
    // quieter noise 40 dB down, then the fart.
    const y = take([1, 0.005], [0.1, 0.05], [0.3, 0.005], [0.5, 0.5])
    const attack = Math.trunc(1.4 * SR) - before
    expect(attack - leadInStart(y, attack)).toBeLessThanOrEqual(frame)
  })

  it('is at most a quarter second', () => {
    // Room noise loud enough (20 dB down) to join the attack, for 1 s before it.
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

    const segment = withLeadIn(source, placed)
    const gain = 10 ** (placed.gainDb / 20)
    const expected = new Float64Array(length)
    const from = placed.startSample - placed.leadSamples
    for (let i = from; i < length; i++) expected[i] += segment[i - from] * gain
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
