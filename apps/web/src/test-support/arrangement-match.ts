// The golden data's rule for when an Arrangement matches (`fixtures/golden/README.md`, "When an
// Arrangement matches"), for the Auto-map and Fart Choices tests. Test input only: nothing here
// ships.
import { expect } from 'vitest'
import { type Arrangement, NOTE_FILL } from '../lib/engine/auto-map'
import type { Song } from '../lib/engine/song'
import { gestureSeconds, goldenRecording } from './engine-golden'

export const TOLERANCE = 1e-9

/**
 * (uncovered, Octave Moves, cost) of an Arrangement, recomputed from the golden data alone: a port
 * of `arrangement_cost()` in `tools/melody-lab/golden_cost.py`, independent of the planner. It
 * rejects a Recording that plays two pitches and any move the unlock rule doesn't allow, by pitch or
 * by length (ADR 0011), on the Recording's own length (ADR 0012).
 */
function arrangementCost(song: Song, transpose: number, recordingFor: Map<number, string | null>) {
  const pitches = [...new Set(song.notes.map(n => n.pitch))].sort((a, b) => a - b)
  expect([...recordingFor.keys()].sort((a, b) => a - b)).toEqual(pitches)
  const used = [...recordingFor.values()].filter(r => r !== null)
  expect(new Set(used).size, 'a Recording plays at most one pitch').toBe(used.length)
  const spb = 60 / song.bpm
  let uncovered = 0
  let octaves = 0
  let cost = 0
  for (const p of pitches) {
    const id = recordingFor.get(p) ?? null
    if (id === null) {
      uncovered++
      continue
    }
    const r = goldenRecording(id)
    expect(r.melodic, `${id} is Melodic`).toBe(true)
    const shift = p + transpose - (r.recording_pitch_midi as number)
    const a = Math.abs(shift)
    let perBeat: number
    if (a <= 3) perBeat = a ** 1.5
    else if (Math.abs(a - 12) <= 3) {
      perBeat = 6 + Math.abs(a - 12) ** 1.5
      octaves++
    } else throw new Error(`${id} can't play ${p + transpose} (shift ${shift})`)
    const notes = song.notes.filter(n => n.pitch === p)
    const played = gestureSeconds(r)
    const longest = Math.max(...notes.map(n => n.dur * spb - 0.025))
    expect(played >= NOTE_FILL * longest, `${id} lasts long enough for ${p + transpose}`).toBe(true)
    const settle = r.settle_s as number
    let short = 0
    let unsettled = 0
    const silent: number[] = []
    for (const n of notes) {
      const sounds = Math.min(n.dur * spb - 0.025, played)
      const shortest = r.shortest_note_s as number
      if (sounds < shortest) short += 8 + 400 * (shortest - sounds)
      unsettled += (20 * Math.min(sounds, settle)) / Math.max(1e-9, sounds)
      silent.push(Math.max(0, n.dur * spb - 0.025 - played))
    }
    cost +=
      neumaierSum(notes.map(n => n.dur)) * perBeat + short + unsettled + 30 * neumaierSum(silent)
  }
  return { uncovered, octaves, cost }
}

/** Python 3.12's `sum()` of floats, as `golden_cost.py` sums a pitch's beats and silent seconds. */
function neumaierSum(values: number[]): number {
  let s = 0
  let c = 0
  for (const x of values) {
    const t = s + x
    c += Math.abs(s) >= Math.abs(x) ? s - t + x : x - t + s
    s = t
  }
  return s + c
}

export interface GoldenFit {
  unlocked: boolean
  pitch_coverage: { covered: number; total: number }
  transpose: number
  octave_moves: number
  plan_cost: number
  missing: { target_midi: number; seconds: number }[]
}

/**
 * The README's matching rule, for an arrangement file, a coverage.json entry or a choices.json
 * state.
 */
export function expectMatches(
  mine: Arrangement,
  golden: GoldenFit,
  recordingFor: Map<number, string | null>,
  song: Song,
  label: string
) {
  expect(mine.unlocked, label).toBe(golden.unlocked)
  expect({ covered: mine.covered, total: mine.total }, label).toEqual(golden.pitch_coverage)
  expect(mine.transposition, label).toBe(golden.transpose)
  expect(mine.octaveMoves, label).toBe(golden.octave_moves)
  expect(new Map(mine.pitches.map(c => [c.songPitch, c.recordingId])), label).toEqual(recordingFor)

  const mineFor = new Map(mine.pitches.map(c => [c.songPitch, c.recordingId]))
  const recomputed = arrangementCost(song, mine.transposition, mineFor)
  expect(recomputed.uncovered, label).toBe(
    golden.pitch_coverage.total - golden.pitch_coverage.covered
  )
  expect(recomputed.octaves, label).toBe(golden.octave_moves)
  expect(Math.abs(recomputed.cost - golden.plan_cost), label).toBeLessThanOrEqual(TOLERANCE)
  expect(Math.abs(mine.cost - golden.plan_cost), label).toBeLessThanOrEqual(TOLERANCE)

  expect(
    mine.missingNotes.map(m => m.midi),
    label
  ).toEqual(mine.pitches.filter(c => c.recordingId === null).map(c => c.targetMidi))
  expect(mine.missingNotes, label).toEqual(
    golden.missing.map(m => ({ midi: m.target_midi, seconds: m.seconds }))
  )
}
