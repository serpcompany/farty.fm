import { describe, expect, it } from 'vitest'
import {
  autoMapInputs,
  coverageSubsets,
  type GoldenArrangement,
  gestureSeconds,
  goldenArrangement,
  goldenRecording,
  goldenSong,
  type Library,
  libraries,
  seededRandom,
  songIds,
  syntheticRecording,
  tieGroups
} from '@/test-support/engine-golden'
import { type Arrangement, arrange, choiceForSongPitch, NOTE_FILL } from './auto-map'
import type { Song } from './song'

const TOLERANCE = 1e-9

function arrangementCostFromGoldenInputs(
  song: Song,
  transpose: number,
  recordingFor: Map<number, string | null>
) {
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
    cost += pythonSum(notes.map(n => n.dur)) * perBeat + short + unsettled + 30 * pythonSum(silent)
  }
  return { uncovered, octaves, cost }
}

function pythonSum(values: number[]): number {
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
  const mineFor = new Map(mine.pitches.map(c => [c.songPitch, c.recordingId]))
  expect(mineFor, label).toEqual(recordingFor)

  const recomputed = arrangementCostFromGoldenInputs(song, mine.transposition, mineFor)
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

describe('Auto-map matches the golden Arrangements, recomputing each cost from the golden inputs', () => {
  for (const library of ['full', 'small'] as Library[]) {
    for (const id of songIds) {
      it(`${library}/${id}`, () => {
        const song = goldenSong(id)
        const golden = goldenArrangement(library, id)
        expectMatchesArrangement(arrange(song, autoMapInputs(libraries[library])), golden, song)
      })
    }
  }

  it('unlocks 9 of the 13 Songs on the full library, and none on the small one with its short farts', () => {
    const unlocked = (library: Library) =>
      songIds.filter(id => arrange(goldenSong(id), autoMapInputs(libraries[library])).unlocked)
    const notesLongerThanAnyNearbyFart = ['jingle', 'row', 'amazing', 'auld']
    expect(unlocked('full')).toEqual(
      songIds.filter(id => !notesLongerThanAnyNearbyFart.includes(id))
    )
    expect(unlocked('small')).toEqual([])
  })
})

describe('Pitch Coverage matches every coverage.json subset', () => {
  coverageSubsets.forEach((subset, s) => {
    it(`subset ${s}: ${subset.recordings.join(' ')}`, () => {
      const library = autoMapInputs(subset.recordings)
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
    const random = seededRandom(108)
    for (const library of ['full', 'small'] as Library[]) {
      for (const id of songIds) {
        const song = goldenSong(id)
        const expected = arrange(song, autoMapInputs(libraries[library]))
        for (let k = 0; k < 5; k++) {
          const shuffled = autoMapInputs(libraries[library])
          for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1))
            ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
          }
          expect(arrange(song, shuffled), `${library}/${id}`).toEqual(expected)
        }
      }
    }
  })

  const oneMiddleCAt120: Song = {
    bpm: 120,
    bar_lines: [0],
    length_beats: 4,
    notes: [{ start: 0, dur: 1, pitch: 60 }]
  }

  it('breaks a tie between transpositions on the Recording ids first', () => {
    const unshiftedAtZero = syntheticRecording('b', 60)
    const unshiftedAtPlusOne = syntheticRecording('a', 61)
    const a = arrange(oneMiddleCAt120, [unshiftedAtZero, unshiftedAtPlusOne])
    expect(a.transposition).toBe(1)
    expect(a.pitches[0].recordingId).toBe('a')
  })

  it('then keeps the lower transposition', () => {
    const halfwayBetweenTwoTranspositions = syntheticRecording('a', 60.5)
    const a = arrange(oneMiddleCAt120, [halfwayBetweenTwoTranspositions])
    expect(a.transposition).toBe(0)
    expect(a.pitches[0].shiftSemitones).toBe(-0.5)
  })

  it('never puts two pitches on one Recording of a tie group, which share one Recording Pitch exactly', () => {
    expect(tieGroups).toEqual([
      ['013', '086'],
      ['016', '022']
    ])
    for (const id of songIds) {
      const a = arrange(goldenSong(id), autoMapInputs(libraries.full))
      const ids = a.pitches.map(c => c.recordingId).filter(r => r !== null)
      expect(new Set(ids).size, id).toBe(ids.length)
    }
  })
})
