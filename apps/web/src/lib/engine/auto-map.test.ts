import { describe, expect, it } from 'vitest'
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
  fills,
  HIGHEST_TRANSPOSITION,
  LOWEST_TRANSPOSITION,
  moveCost,
  NOTE_FILL,
  neededSeconds,
  PLACED_SHORTEST_NOTE_SECONDS,
  placedAutoMapRecording,
  silentCost,
  tooShortCost,
  unsettledCost
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

interface GoldenFit {
  unlocked: boolean
  pitch_coverage: { covered: number; total: number }
  transpose: number
  octave_moves: number
  plan_cost: number
  missing: { target_midi: number; seconds: number }[]
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

  expect(
    mine.missingNotes.map(m => m.midi),
    label
  ).toEqual(mine.pitches.filter(c => c.recordingId === null).map(c => c.targetMidi))
  expect(mine.missingNotes, label).toEqual(
    golden.missing.map(m => ({ midi: m.target_midi, seconds: m.seconds }))
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

  it('unlocks all 13 Songs on the full library and 2 on the small one', () => {
    const unlocked = (library: Library) =>
      songIds.filter(id => arrange(goldenSong(id), inputs(libraries[library])).unlocked)
    // Every burst plays (ADR 0016), so the long notes jingle, row, amazing and auld need have
    // farts long enough (ADR 0011). The small library's six are still too short for those, and
    // with 009 Melodic since the second pitch window (ADR 0017) they unlock mary and saints.
    expect(unlocked('full')).toEqual(songIds)
    expect(unlocked('small')).toEqual(['mary', 'saints'])
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

  // No golden Song has two equally good transpositions (the smallest gap is 0.25), so these build
  // one: a single 60 at 120 bpm.
  const oneNote: Song = {
    bpm: 120,
    bar_lines: [0],
    length_beats: 4,
    notes: [{ start: 0, dur: 1, pitch: 60 }]
  }
  const recording = (id: string, recordingPitchMidi: number) => ({
    id,
    recordingPitchMidi,
    shortestNoteSeconds: 0.1,
    gestureSeconds: 2,
    settleSeconds: 0
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
    // 013 and 086, and 016 and 022, share one Recording Pitch exactly, so a planner that looks
    // Recordings up by pitch would reuse one of them. The matching rule above already rejects that;
    // this says so.
    expect(tieGroups).toEqual([
      ['013', '086'],
      ['016', '022']
    ])
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
        shortestNoteSeconds: g.shortest_note_s,
        settleSeconds: g.settle_s
      }
      expect(autoMapRecording(g.id, analysis)).toEqual(autoMapInput(g.id))
    }
  })

  it('reads an analysis stored before the settle time as an unknown settle time', () => {
    const g = goldenRecording('017')
    const analysis: Analysis = {
      gestureStartSeconds: g.gesture.start_sample / SR,
      gestureEndSeconds: g.gesture.end_sample / SR,
      cutAtReattack: g.gesture.cut_at_reattack,
      pitchEstimateMidi: g.pitch_estimate_midi,
      pitchConfidence: g.pitch_confidence,
      recordingPitchMidi: g.recording_pitch_midi,
      shortestNoteSeconds: g.shortest_note_s
    }
    expect(autoMapRecording(g.id, analysis)).toEqual({ ...autoMapInput(g.id), settleSeconds: null })
  })

  it('costs an unknown settle time nothing, like one that is settled at once', () => {
    const song = goldenSong('birthday')
    const unknown = inputs(libraries.full).map(r => ({ ...r, settleSeconds: null }))
    const atOnce = inputs(libraries.full).map(r => ({ ...r, settleSeconds: 0 }))
    expect(arrange(song, unknown)).toEqual(arrange(song, atOnce))
    expect(arrange(song, inputs(libraries.full)).cost).toBeGreaterThan(arrange(song, unknown).cost)
  })

  it('leaves a Song locked, at the lowest transposition, when no Recording is Melodic', () => {
    const song = goldenSong('mary')
    const noise = inputs(['018', '052', '055'])
    expect(noise.every(r => r.recordingPitchMidi === null)).toBe(true)
    const a = arrange(song, noise)
    expect(a.transposition).toBe(LOWEST_TRANSPOSITION)
    expect(a.covered).toBe(0)
    expect(a.unlocked).toBe(false)
    const pitches = [...new Set(song.notes.map(n => n.pitch))].sort((x, y) => x - y)
    expect(a.missingNotes.map(m => m.midi)).toEqual(pitches.map(p => p + LOWEST_TRANSPOSITION))
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

  it('covers a pitch only with a Recording as long as its longest note', () => {
    expect(NOTE_FILL).toBe(1)
    // A 1 s note needs 1 s of fart. Farts play raw (ADR 0012), so no move makes one longer.
    expect(fills(1, 1)).toBe(true)
    expect(fills(0.99, 1)).toBe(false)
    // A 0.975 s half note at 120 bpm: a 1 s fart covers it, a 0.8 s fart doesn't at any
    // transposition, even with an Octave Move.
    const half: Song = {
      bpm: 120,
      bar_lines: [0],
      length_beats: 3,
      notes: [
        { start: 0, dur: 1, pitch: 60 },
        { start: 1, dur: 2, pitch: 60 }
      ]
    }
    const fart = (gestureSeconds: number) => [
      {
        id: 'a',
        recordingPitchMidi: 60,
        shortestNoteSeconds: 0.12,
        gestureSeconds,
        settleSeconds: 0
      }
    ]
    expect(arrange(half, fart(1))).toMatchObject({
      unlocked: true,
      transposition: 0,
      octaveMoves: 0
    })
    expect(arrange(half, fart(0.8))).toMatchObject({
      unlocked: false,
      missingNotes: [{ midi: 60 + LOWEST_TRANSPOSITION, seconds: 1 }]
    })
  })

  it('says how long a fart each missing note needs, rounded up to 0.1 s', () => {
    expect(neededSeconds(0.975)).toBe(1)
    expect(neededSeconds(0.475)).toBe(0.5)
    expect(neededSeconds(2.975)).toBe(3)
    // 0.7 × 10 is 7.000000000000001 in floating point: still 0.7 s, not 0.8 s.
    expect(neededSeconds(0.7)).toBe(0.7)
  })

  /** A fart of `seconds`, in whole samples, as Recording Analysis measures one. */
  const exactly = (seconds: number) => Math.round(seconds * SR) / SR

  it('says the shortest length, in tenths of a second, that fills every pitch of every Song', () => {
    let pitches = 0
    for (const id of songIds) {
      const song = goldenSong(id)
      const spb = 60 / song.bpm
      for (const p of new Set(song.notes.map(n => n.pitch))) {
        // As `arrange` measures a pitch's longest note, to the last bit.
        const longest = Math.max(
          ...song.notes.filter(n => n.pitch === p).map(n => n.dur * spb - 0.025)
        )
        const needed = neededSeconds(longest)
        expect(fills(exactly(needed), longest), `${id} ${p}: ${needed} s`).toBe(true)
        expect(fills(exactly(needed - 0.1), longest), `${id} ${p}: ${needed} s`).toBe(false)
        pitches++
      }
    }
    expect(pitches).toBeGreaterThan(70)
  })

  it('unlocks a locked Song with farts as long as it says, 3 semitones or an octave from each note', () => {
    // Songs play every fart at its own length (ADR 0012), so the stated length holds for any fart
    // that may play the note: 3 semitones below or above it, or an octave away (an Octave Move).
    let locked = 0
    let lockedInGolden = 0
    for (const library of Object.keys(libraries) as Library[]) {
      const recordings = libraries[library].map(autoMapInput)
      for (const id of songIds) {
        if (!goldenArrangement(library, id).unlocked) lockedInGolden++
        const song = goldenSong(id)
        const { unlocked, missingNotes } = arrange(song, recordings)
        if (unlocked) continue
        locked++
        for (const fromNote of [-3, 3, -12, 12]) {
          const farts = missingNotes.map(m => ({
            id: `new-${m.midi}`,
            recordingPitchMidi: m.midi + fromNote,
            shortestNoteSeconds: 0.1,
            gestureSeconds: exactly(m.seconds),
            settleSeconds: 0
          }))
          expect(
            arrange(song, [...recordings, ...farts]).unlocked,
            `${id} on the ${library} library, farts ${fromNote} semitones from ${missingNotes.map(m => `${m.midi} (${m.seconds} s)`).join(', ')}`
          ).toBe(true)
        }
      }
    }
    expect(locked).toBe(lockedInGolden)
    expect(locked).toBeGreaterThan(0)
  })

  it('charges notes that sound shorter than the Recording can settle', () => {
    expect(tooShortCost([0.5], 1, 0.35)).toBe(0)
    expect(tooShortCost([0.3], 1, 0.35)).toBeCloseTo(8 + 400 * 0.05, 9)
    // A 0.4 s gesture sounds for 0.4 s of a 0.5 s note.
    expect(tooShortCost([0.5], 0.4, 0.6)).toBeCloseTo(8 + 400 * 0.2, 9)
    expect(tooShortCost([0.5, 0.2, 0.4], 0.3, 0.35)).toBeCloseTo(
      3 * 8 + 400 * (0.05 + 0.15 + 0.05),
      9
    )
  })

  it('charges the share of each note played before the Recording settles', () => {
    // 0.5 s notes on a 1 s gesture that settles at 0.1 s: a fifth of each note is unsettled.
    expect(unsettledCost([0.5], 1, 0.1)).toBeCloseTo(20 * 0.2, 9)
    expect(unsettledCost([0.05], 1, 0.1)).toBeCloseTo(20, 9)
    expect(unsettledCost([2], 1, 0.1)).toBeCloseTo(20 * 0.1, 9)
    // A 0.25 s gesture sounds for 0.25 s of the note, and settles in the first 0.1 s of it.
    expect(unsettledCost([0.5], 0.25, 0.1)).toBeCloseTo(20 * 0.4, 9)
    expect(unsettledCost([0.5, 0.05], 1, 0)).toBe(0)
  })

  it('charges the seconds of each note the Recording is too short to fill', () => {
    // A 0.4 s gesture leaves 0.6 s of a 1 s note silent, and nothing of a 0.3 s note.
    expect(silentCost([1, 0.3], 0.4)).toBeCloseTo(30 * 0.6, 9)
    expect(silentCost([0.3], 0.4)).toBe(0)
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

describe('Placed Recordings (ADR 0015)', () => {
  /** A golden Recording's stored analysis. */
  function storedAnalysis(id: string): Analysis {
    const g = goldenRecording(id)
    return {
      gestureStartSeconds: g.gesture.start_sample / SR,
      gestureEndSeconds: g.gesture.end_sample / SR,
      cutAtReattack: g.gesture.cut_at_reattack,
      pitchEstimateMidi: g.pitch_estimate_midi,
      pitchConfidence: g.pitch_confidence,
      recordingPitchMidi: g.melodic ? g.recording_pitch_midi : null,
      shortestNoteSeconds: g.melodic ? g.shortest_note_s : null,
      settleSeconds: g.melodic ? g.settle_s : null
    }
  }
  const C2 = 36
  /** A golden Recording as Auto-map takes it placed on C2. */
  const placedInput = (id: string) => ({
    ...autoMapInput(id),
    recordingPitchMidi: C2,
    shortestNoteSeconds: PLACED_SHORTEST_NOTE_SECONDS,
    settleSeconds: 0
  })

  it('counts as Melodic at its note, at its own length, holding it from 0.6 s', () => {
    expect(goldenRecording('065').melodic).toBe(false)
    expect(placedAutoMapRecording('065', storedAnalysis('065'), C2)).toEqual(placedInput('065'))
    expect(PLACED_SHORTEST_NOTE_SECONDS).toBe(0.6)
  })

  it('stays at its Placed Pitch when a later analysis finds a Recording Pitch (ADR 0017)', () => {
    // 009 was Noise-like until the second pitch window found it near G1 (#282).
    expect(storedAnalysis('009').recordingPitchMidi).toBeCloseTo(30.5259, 4)
    expect(placedAutoMapRecording('009', storedAnalysis('009'), C2)).toEqual(placedInput('009'))
  })

  // The same Arrangements as `tools/melody-lab/test_placed.py`.
  it('covers a note nothing else does: 065 on C2 unlocks 2 Songs the small library leaves locked', () => {
    const placed = [
      ...inputs(libraries.small),
      placedAutoMapRecording('065', storedAnalysis('065'), C2)
    ]
    const expected = {
      jingle: { covered: 5, total: 5, octaveMoves: 2, cost: 260.0875, plays: 67 },
      row: { covered: 6, total: 6, octaveMoves: 2, cost: 821.0865, plays: 67 }
    }
    for (const [id, e] of Object.entries(expected)) {
      const song = goldenSong(id)
      expect(arrange(song, inputs([...libraries.small, '065'])).unlocked, id).toBe(false)
      const a = arrange(song, placed)
      expect({ covered: a.covered, total: a.total, octaveMoves: a.octaveMoves }, id).toEqual({
        covered: e.covered,
        total: e.total,
        octaveMoves: e.octaveMoves
      })
      expect(a.cost, id).toBeCloseTo(e.cost, 3)
      expect(
        a.pitches.filter(p => p.recordingId === '065').map(p => p.songPitch),
        id
      ).toEqual([e.plays])
    }
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
