import { describe, expect, it } from 'vitest'
import { exp2 } from '@/lib/analysis/numeric'
import type { Analysis } from '@/lib/recordings'
import {
  autoMapInput,
  coverageSubsets,
  type GoldenArrangement,
  gestureSeconds,
  goldenArrangement,
  goldenRecording,
  goldenSong,
  type Library,
  libraries,
  songIds,
  tieGroups
} from '@/test-support/engine-golden'
import { goldenRecordings, row } from '@/test-support/golden'
import { minimumCost } from './assignment'
import {
  type Arrangement,
  arrange,
  autoMapRecording,
  choiceForSongPitch,
  compareIds,
  HIGHEST_TRANSPOSITION,
  LOWEST_TRANSPOSITION,
  moveCost,
  tooShortCost
} from './auto-map'
import type { Song } from './song'

// Auto-map against the reference's golden Arrangements and Pitch Coverage, under the rule in
// `fixtures/golden/README.md` ("When an Arrangement matches"). Inputs are the golden analyses, so
// a difference in Recording Analysis can't fail this test.

const TOLERANCE = 1e-9
const SR = 44100

/**
 * (uncovered, Octave Moves, cost) of an Arrangement, recomputed from the golden data alone: a port
 * of `arrangement_cost()` in `tools/melody-lab/golden_cost.py`, independent of the planner. It
 * rejects a Recording that plays two pitches and any move the unlock rule doesn't allow.
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
    const played = gestureSeconds(r) * exp2(-shift / 12)
    let short = 0
    for (const n of notes) {
      const sounds = Math.min(n.dur * spb - 0.025, played)
      const shortest = r.shortest_note_s as number
      if (sounds < shortest) short += 8 + 400 * (shortest - sounds)
    }
    cost += neumaierSum(notes.map(n => n.dur)) * perBeat + short
  }
  return { uncovered, octaves, cost }
}

/** Python 3.12's `sum()` of floats, as `golden_cost.py` sums a pitch's beats. */
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

interface GoldenFit {
  unlocked: boolean
  pitch_coverage: { covered: number; total: number }
  transpose: number
  octave_moves: number
  plan_cost: number
}

/** The README's matching rule, for an arrangement file or a coverage.json entry. */
function expectMatches(
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

  expect(mine.missingNotes, label).toEqual(
    mine.pitches.filter(c => c.recordingId === null).map(c => c.targetMidi)
  )
}

function expectMatchesArrangement(mine: Arrangement, golden: GoldenArrangement, song: Song) {
  const label = `${golden.library}/${golden.song}`
  const recordingFor = new Map(golden.per_pitch.map(x => [x.song_pitch, x.recording]))
  expectMatches(mine, golden, recordingFor, song, label)
  golden.per_pitch.forEach((g, i) => {
    const c = mine.pitches[i]
    expect(c.songPitch, label).toBe(g.song_pitch)
    expect(c.targetMidi, label).toBe(g.target_midi)
    if (g.shift_semitones === null) expect(c.shiftSemitones, label).toBeNull()
    else expect(Math.abs((c.shiftSemitones as number) - g.shift_semitones)).toBeLessThan(TOLERANCE)
    expect(c.octaveMove, label).toBe(g.octave_move ?? false)
  })
  if (golden.unlocked) {
    for (const g of golden.notes ?? []) {
      const note = song.notes[g.index]
      const choice = choiceForSongPitch(mine, note.pitch)
      expect(note.pitch + mine.transposition, `${label} note ${g.index}`).toBe(g.target_midi)
      expect(choice?.recordingId, `${label} note ${g.index}`).toBe(g.recording)
    }
  }
}

const inputs = (ids: readonly string[]) => ids.map(autoMapInput)

describe('Auto-map matches the golden Arrangements', () => {
  for (const library of ['full', 'small'] as Library[]) {
    for (const id of songIds) {
      it(`${library}/${id}`, () => {
        const song = goldenSong(id)
        const golden = goldenArrangement(library, id)
        expectMatchesArrangement(arrange(song, inputs(libraries[library])), golden, song)
      })
    }
  }

  it('unlocks all 13 Songs on the full library and none on the small one', () => {
    const unlocked = (library: Library) =>
      songIds.filter(id => arrange(goldenSong(id), inputs(libraries[library])).unlocked).length
    expect(unlocked('full')).toBe(13)
    expect(unlocked('small')).toBe(0)
  })
})

describe('Pitch Coverage matches every coverage.json subset', () => {
  coverageSubsets.forEach((subset, s) => {
    it(`subset ${s}: ${subset.recordings.join(' ')}`, () => {
      const library = inputs(subset.recordings)
      for (const golden of subset.songs) {
        const song = goldenSong(golden.song)
        const recordingFor = new Map(
          Object.entries(golden.recording_for_pitch).map(([p, r]) => [Number(p), r])
        )
        expectMatches(
          arrange(song, library),
          golden,
          recordingFor,
          song,
          `subset ${s} ${golden.song}`
        )
      }
    })
  })
})

describe('Auto-map ties', () => {
  it('gives the same Arrangement whatever order the library is in', () => {
    let seed = 108
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      return seed / 2 ** 31
    }
    for (const library of ['full', 'small'] as Library[]) {
      for (const id of songIds) {
        const song = goldenSong(id)
        const expected = arrange(song, inputs(libraries[library]))
        for (let k = 0; k < 5; k++) {
          const shuffled = inputs(libraries[library])
          for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1))
            ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
          }
          expect(arrange(song, shuffled), `${library}/${id}`).toEqual(expected)
        }
      }
    }
  })

  // No golden Song has two equally good transpositions (the smallest gap is 3.2), so these build
  // one: a single 60 at 120 bpm.
  const oneNote: Song = {
    bpm: 120,
    beats_per_bar: 4,
    length_beats: 4,
    notes: [{ start: 0, dur: 1, pitch: 60 }]
  }
  const recording = (id: string, recordingPitchMidi: number) => ({
    id,
    recordingPitchMidi,
    shortestNoteSeconds: 0.1,
    gestureSeconds: 2
  })

  it('breaks a tie between transpositions on the Recording ids first', () => {
    // 'b' plays 60 unshifted at +0, 'a' plays it unshifted at +1: both cost 0, and 'a' sorts first.
    const a = arrange(oneNote, [recording('b', 60), recording('a', 61)])
    expect(a.transposition).toBe(1)
    expect(a.pitches[0].recordingId).toBe('a')
  })

  it('then keeps the lower transposition', () => {
    // 60.5 is half a semitone from both 60 (+0) and 61 (+1): the same Recording, the same cost.
    const a = arrange(oneNote, [recording('a', 60.5)])
    expect(a.transposition).toBe(0)
    expect(a.pitches[0].shiftSemitones).toBe(-0.5)
  })

  it('never puts two tied pitches on one Recording of a tie group', () => {
    // 013, 084 and 086 share one Recording Pitch exactly, so a planner that looks Recordings up by
    // pitch would reuse one of them. The matching rule above already rejects that; this says so.
    expect(tieGroups).toEqual([['013', '084', '086']])
    for (const id of songIds) {
      const a = arrange(goldenSong(id), inputs(libraries.full))
      const ids = a.pitches.map(c => c.recordingId).filter(r => r !== null)
      expect(new Set(ids).size, id).toBe(ids.length)
    }
  })
})

describe('Auto-map inputs and terms', () => {
  it('reads the gesture length in whole samples from a stored analysis', () => {
    for (const g of goldenRecordings) {
      const analysis: Analysis = {
        gestureStartSeconds: g.gesture.start_sample / SR,
        gestureEndSeconds: g.gesture.end_sample / SR,
        cutAtReattack: g.gesture.cut_at_reattack,
        pitchEstimateMidi: g.pitch_estimate_midi,
        pitchConfidence: g.pitch_confidence,
        recordingPitchMidi: g.recording_pitch_midi,
        shortestNoteSeconds: g.shortest_note_s
      }
      expect(autoMapRecording(g.id, analysis)).toEqual(autoMapInput(g.id))
    }
  })

  it('leaves a Song locked, at the lowest transposition, when no Recording is Melodic', () => {
    const song = goldenSong('mary')
    const noise = inputs(['002', '009', '016'])
    expect(noise.every(r => r.recordingPitchMidi === null)).toBe(true)
    const a = arrange(song, noise)
    expect(a.transposition).toBe(LOWEST_TRANSPOSITION)
    expect(a.covered).toBe(0)
    expect(a.unlocked).toBe(false)
    const pitches = [...new Set(song.notes.map(n => n.pitch))].sort((x, y) => x - y)
    expect(a.missingNotes).toEqual(pitches.map(p => p + LOWEST_TRANSPOSITION))
    expect(arrange(song, []).missingNotes).toEqual(a.missingNotes)
    expect(HIGHEST_TRANSPOSITION).toBe(24)
  })

  it('allows a move of 3 semitones, or 3 from an octave, either way', () => {
    expect(moveCost(0)).toEqual({ cost: 0, octaveMove: false })
    expect(moveCost(-3)).toEqual({ cost: 3 ** 1.5, octaveMove: false })
    expect(moveCost(3.01)).toBeNull()
    expect(moveCost(8.99)).toBeNull()
    expect(moveCost(9)).toEqual({ cost: 6 + 3 ** 1.5, octaveMove: true })
    expect(moveCost(-12)).toEqual({ cost: 6, octaveMove: true })
    expect(moveCost(15)).toEqual({ cost: 6 + 3 ** 1.5, octaveMove: true })
    expect(moveCost(15.01)).toBeNull()
  })

  it('charges notes that sound shorter than the Recording can settle', () => {
    // 0.5 s notes on a 1 s gesture: an Octave Move up halves the gesture to exactly 0.5 s.
    expect(tooShortCost([0.5], 1, 0.35, 0)).toBe(0)
    expect(tooShortCost([0.3], 1, 0.35, 0)).toBeCloseTo(8 + 400 * 0.05, 9)
    expect(tooShortCost([0.5], 1, 0.6, 12)).toBeCloseTo(8 + 400 * 0.1, 9)
    expect(tooShortCost([0.5, 0.2, 0.4], 0.3, 0.35, 0)).toBeCloseTo(
      3 * 8 + 400 * (0.05 + 0.15 + 0.05),
      9
    )
  })

  it('orders ids by code point', () => {
    expect(['b', 'a', '10', '9', 'Z', 'é', '😀', 'ｚ'].sort(compareIds)).toEqual([
      '10',
      '9',
      'Z',
      'a',
      'b',
      'é',
      'ｚ',
      '😀'
    ])
    expect(compareIds('ab', 'a')).toBeGreaterThan(0)
    expect(compareIds('013', '013')).toBe(0)
  })
})

describe('the assignment solver', () => {
  it('finds a minimum-cost assignment, like brute force', () => {
    let seed = 7
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      return seed / 2 ** 31
    }
    for (let trial = 0; trial < 300; trial++) {
      const rows = 1 + Math.floor(random() * 4)
      const columns = rows + Math.floor(random() * 3)
      const a = new Float64Array(rows * columns)
      for (let k = 0; k < a.length; k++)
        a[k] = random() < 0.2 ? Infinity : Math.floor(random() * 20)
      for (let r = 0; r < rows; r++) a[r * columns + ((r + trial) % columns)] = 5 // every row allowed
      let best = Infinity
      const visit = (r: number, used: Set<number>, total: number) => {
        if (r === rows) {
          best = Math.min(best, total)
          return
        }
        for (let c = 0; c < columns; c++) {
          if (used.has(c) || a[r * columns + c] === Infinity) continue
          used.add(c)
          visit(r + 1, used, total + a[r * columns + c])
          used.delete(c)
        }
      }
      visit(0, new Set(), 0)
      // With no full assignment it refuses; the planner always adds an "uncovered" column per row.
      if (best === Infinity) {
        expect(() => minimumCost(a, rows, columns)).toThrow(RangeError)
        continue
      }
      const picked = minimumCost(a, rows, columns)
      expect(new Set(picked).size).toBe(rows)
      expect(picked.reduce((s, c, r) => s + a[r * columns + c], 0)).toBe(best)
    }
  })

  it('refuses more rows than columns', () => {
    expect(() => minimumCost(new Float64Array(2), 2, 1)).toThrow(RangeError)
  })
})

describe('Auto-map timing', () => {
  it('arranges every Song on the full library quickly', () => {
    const library = inputs(libraries.full)
    const runs: number[] = []
    for (let k = 0; k < 8; k++) {
      const start = performance.now()
      for (const id of songIds) arrange(goldenSong(id), library)
      runs.push(performance.now() - start)
    }
    const median = runs.slice(1).sort((a, b) => a - b)[3]
    console.log(
      row('auto-map', `${songIds.length} Songs`, `${median.toFixed(1)} ms`, 'median of 7')
    )
    expect(median).toBeLessThan(5000)
  })
})
