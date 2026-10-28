import { ANALYSIS_SAMPLE_RATE } from '@/lib/analysis/resample'
import type { Analysis } from '@/lib/recordings'
import { minimumCost } from './assignment'
import { type Song, secondsPerBeat } from './song'

// Auto-map and Pitch Coverage: a port of `AutoMap.swift`, the iPhone 1.0 planner, which ports the
// reference engine's `melody_fit()` (`tools/melody-lab/engine.py`) and the unlock rule of ADR 0004,
// ADR 0006 and ADR 0011. Since #116 it also has the reference's settle cost, since #205 its silence
// cost, since #221 its length rule, and since ADR 0012 every length is the Recording's own, which
// the Swift port, frozen at golden format 2, doesn't have.
//
// Each distinct Song pitch gets its own Melodic Recording (one to one, never reused), at most 3
// semitones from the note, or with an Octave Move (12 semitones up or down, plus at most 3) where
// the Song needs it, and at least as long as the pitch's longest note (`fills`). Songs play every
// fart raw, at its own pitch and length (ADR 0012), so the shift only decides which Recording may
// play a pitch and what it costs, and an Octave Move plays its fart an octave from the note. Every
// transposition from −36 to +24 is tried. Arrangements rank by:
// 1. the most pitches covered (Pitch Coverage);
// 2. the fewest Octave Moves;
// 3. the lowest cost, where costs within `TIE` are equal;
// 4. the Recording ids read in ascending Song pitch order, lexicographically smallest, with an
//    uncovered pitch after every id; then the lower transposition.
//
// A Song is unlocked when every distinct pitch is covered.

/** The furthest a note may be from its Recording Pitch, or from the same note an octave away, in semitones. */
export const MAXIMUM_SHIFT = 3
const OCTAVE = 12
/** Cost per beat of an Octave Move, on top of the remaining shift: more than any real-pitch move (3^1.5 = 5.2). */
const OCTAVE_MOVE_COST = 6
/** Cost of a note that sounds too briefly for its Recording to settle on its pitch ... */
const TOO_SHORT_COST = 8
/** ... plus this per second it falls short. */
const TOO_SHORT_COST_PER_SECOND = 400
/** Cost of a note played entirely before its Recording settles on pitch; less for part of it. */
const UNSETTLED_COST = 20
/** Cost per second of a note its Recording is too short to fill. */
const SILENT_COST_PER_SECOND = 30
/** Silence before the next note: a note sounds for its length minus this. */
const GAP_SECONDS = 0.025
/**
 * A Recording covers a pitch only if it lasts this share of the pitch's longest note (#221). ADR
 * 0011 has the measurement, made when farts were still resampled: 0.9 and 0.75 left Für Elise
 * under ADR 0004's bar.
 */
export const NOTE_FILL = 1.0
/** Arrangement costs this close are equal. */
const TIE = 1e-9
/** The transpositions tried, in semitones: −36 to +24. */
export const LOWEST_TRANSPOSITION = -36
export const HIGHEST_TRANSPOSITION = 24

/**
 * A Recording as Auto-map sees it. Only Melodic Recordings can play a pitch, and Placed Recordings,
 * which come in as Melodic ones (`placedAutoMapRecording`).
 */
export interface AutoMapRecording {
  /** Ties between equally good Arrangements break on these ids, in code point order. */
  id: string
  /** The Recording Pitch in MIDI; null for a Noise-like Recording. */
  recordingPitchMidi: number | null
  /** The shortest note the Recording plays on pitch, in seconds; null when Noise-like. */
  shortestNoteSeconds: number | null
  /** The length of the Recording's single clean gesture, in seconds. */
  gestureSeconds: number
  /**
   * When the Recording settles on its pitch, in seconds from the gesture start. Null when not
   * known (an analysis stored before #116), which costs nothing.
   */
  settleSeconds: number | null
}

/**
 * A Recording from its stored analysis. The gesture length is recovered in whole samples, as the
 * reference measures it.
 */
export function autoMapRecording(id: string, analysis: Analysis): AutoMapRecording {
  const sr = ANALYSIS_SAMPLE_RATE
  const samples =
    Math.round(analysis.gestureEndSeconds * sr) - Math.round(analysis.gestureStartSeconds * sr)
  return {
    id,
    recordingPitchMidi: analysis.recordingPitchMidi,
    shortestNoteSeconds: analysis.shortestNoteSeconds,
    gestureSeconds: samples / sr,
    settleSeconds: analysis.settleSeconds ?? null
  }
}

/**
 * The shortest note a Placed Recording counts as holding on pitch, in seconds: the longest note
 * the reference's `audition()` tries, so a fart placed by ear counts as the slowest Melodic
 * Recording analysis accepts (ADR 0015). Shorter notes cost it `tooShortCost`, so Auto-map gives
 * them to an analyzed fart at the same distance, but it still covers a pitch nothing else can.
 */
export const PLACED_SHORTEST_NOTE_SECONDS = 0.6

/**
 * A Noise-like Recording the user placed on `placedMidi` by ear, as Auto-map sees it (ADR 0015): a
 * Melodic Recording at that note that holds it from `PLACED_SHORTEST_NOTE_SECONDS` and settles at
 * once, at its own length. The reference's `placed()` makes the same `Source`. It still plays raw
 * (ADR 0012), so the note only decides which pitches it may play.
 */
export function placedAutoMapRecording(
  id: string,
  analysis: Analysis,
  placedMidi: number
): AutoMapRecording {
  return {
    ...autoMapRecording(id, analysis),
    recordingPitchMidi: placedMidi,
    shortestNoteSeconds: PLACED_SHORTEST_NOTE_SECONDS,
    settleSeconds: 0
  }
}

/** Which Recording plays one distinct Song pitch. */
export interface PitchChoice {
  /** The Song's pitch, before transposition. */
  songPitch: number
  /** The note to play: `songPitch` plus the transposition. */
  targetMidi: number
  /** The Recording that plays every note at this pitch; null when none covers it. */
  recordingId: string | null
  /**
   * Target minus Recording Pitch, in semitones: how far the note is from its fart, which plays
   * unshifted (ADR 0012); null when uncovered.
   */
  shiftSemitones: number | null
  /** The note is 12 ± 3 semitones from the Recording Pitch, so the fart plays an octave from it (ADR 0012). */
  octaveMove: boolean
}

/**
 * Auto-map's answer for one Song: Pitch Coverage, and the Arrangement of the pitches it covers. A
 * locked Song keeps its partial Arrangement, so `missingNotes` can say which notes would unlock it.
 * Plain data, so it crosses to and from a Web Worker as it is.
 */
export interface Arrangement {
  /** The transposition in semitones. */
  transposition: number
  /** One entry per distinct Song pitch, lowest first. */
  pitches: PitchChoice[]
  /** How many pitches use an Octave Move. */
  octaveMoves: number
  /** The Arrangement's cost, summed over covered pitches in ascending pitch order. */
  cost: number
  /** Pitch Coverage: how many distinct pitches have their own Recording ("3 of 4 notes covered"). */
  covered: number
  total: number
  /** Every distinct pitch has its own Recording, so the Song can be played. */
  unlocked: boolean
  /** The notes that no Recording covers, lowest first, with how long a fart each needs. */
  missingNotes: MissingNote[]
}

/** A note no Recording covers yet, and the shortest Recording near it that would cover it. */
export interface MissingNote {
  /** The note, after transposition, as a MIDI note number. */
  midi: number
  /** The shortest Recording at that pitch that covers it, in seconds, rounded up to 0.1 s. */
  seconds: number
}

/**
 * Chooses the transposition and a Recording for each distinct pitch of `song`: Auto-map, and so
 * Pitch Coverage.
 *
 * Synchronous and CPU-bound. Noise-like Recordings are ignored. The answer doesn't depend on the
 * order of `recordings`.
 */
export function arrange(song: Song, recordings: readonly AutoMapRecording[]): Arrangement {
  const melodic = recordings.filter(isMelodic).sort((a, b) => compareIds(a.id, b.id))
  const pitches = [...new Set(song.notes.map(n => n.pitch))].sort((a, b) => a - b)
  const spb = secondsPerBeat(song)
  const weight: number[] = []
  const noteSeconds: number[][] = []
  const longest: number[] = []
  for (const p of pitches) {
    const notes = song.notes.filter(n => n.pitch === p)
    weight.push(pythonSum(notes.map(n => n.dur)))
    noteSeconds.push(notes.map(n => n.dur * spb - GAP_SECONDS))
    longest.push(Math.max(...noteSeconds[noteSeconds.length - 1]))
  }

  const tables: Table[] = []
  for (let t = LOWEST_TRANSPOSITION; t <= HIGHEST_TRANSPOSITION; t++) {
    tables.push(new Table(pitches, melodic, t, weight, noteSeconds, longest))
  }
  const best = tables.map(table => table.solve([]).key)
  let top = best[0]
  for (const k of best) {
    if (k.uncovered < top.uncovered || (k.uncovered === top.uncovered && k.octaves < top.octaves)) {
      top = k
    }
  }
  const sameRank = (k: Key) => k.uncovered === top.uncovered && k.octaves === top.octaves
  let low = Number.POSITIVE_INFINITY
  for (const k of best) if (sameRank(k) && k.cost < low) low = k.cost
  const isOptimal = (k: Key) => sameRank(k) && k.cost <= low + TIE

  let winner: { ids: (string | null)[]; index: number; choice: (number | null)[] } | null = null
  for (let index = 0; index < tables.length; index++) {
    if (!isOptimal(best[index])) continue
    const choice = tables[index].smallestIds(isOptimal)
    const ids = choice.map(j => (j === null ? null : melodic[j].id))
    // Transpositions are visited in ascending order, so on equal ids the lower one stays.
    if (winner === null || idsPrecede(ids, winner.ids)) winner = { ids, index, choice }
  }
  // The best key came from some transposition, so one is always optimal.
  if (winner === null) throw new Error('Auto-map found no optimal transposition')
  const { index, choice } = winner
  const table = tables[index]
  const t = LOWEST_TRANSPOSITION + index
  const key = table.key(choice)
  const picked: PitchChoice[] = pitches.map((p, i) => {
    const j = choice[i]
    if (j === null) {
      return {
        songPitch: p,
        targetMidi: p + t,
        recordingId: null,
        shiftSemitones: null,
        octaveMove: false
      }
    }
    return {
      songPitch: p,
      targetMidi: p + t,
      recordingId: melodic[j].id,
      shiftSemitones: p + t - (melodic[j].recordingPitchMidi as number),
      octaveMove: table.isOctaveMove[i * table.columns + j] === 1
    }
  })
  const covered = picked.filter(c => c.recordingId !== null).length
  return {
    transposition: t,
    pitches: picked,
    octaveMoves: key.octaves,
    cost: key.cost,
    covered,
    total: picked.length,
    unlocked: covered === picked.length,
    missingNotes: picked.flatMap((c, i) =>
      c.recordingId === null ? [{ midi: c.targetMidi, seconds: neededSeconds(longest[i]) }] : []
    )
  }
}

/** The choice for a Song pitch (before transposition). */
export function choiceForSongPitch(arrangement: Arrangement, pitch: number): PitchChoice | null {
  return arrangement.pitches.find(c => c.songPitch === pitch) ?? null
}

function isMelodic(r: AutoMapRecording): boolean {
  return r.recordingPitchMidi !== null && r.shortestNoteSeconds !== null
}

/**
 * Cost per beat of playing a note `shift` semitones from the Recording Pitch, and whether that is
 * an Octave Move; null when the unlock rule doesn't allow it. Octave Moves go up or down on equal
 * terms (ADR 0006).
 */
export function moveCost(shift: number): { cost: number; octaveMove: boolean } | null {
  const a = Math.abs(shift)
  if (a <= MAXIMUM_SHIFT) return { cost: a ** 1.5, octaveMove: false }
  if (Math.abs(a - OCTAVE) <= MAXIMUM_SHIFT) {
    return { cost: OCTAVE_MOVE_COST + Math.abs(a - OCTAVE) ** 1.5, octaveMove: true }
  }
  return null
}

/**
 * Whether a Recording is long enough to cover a pitch (#221, ADR 0011): at its own length (ADR
 * 0012), it lasts at least `NOTE_FILL` × the longest of the pitch's notes, each its written length
 * less the gap. Recordings are never stretched (ADR 0004).
 */
export function fills(recordingSeconds: number, longestNoteSeconds: number): boolean {
  return recordingSeconds >= NOTE_FILL * longestNoteSeconds
}

/**
 * The shortest Recording, at its own pitch, that covers a pitch whose longest note lasts
 * `longestNoteSeconds`: `NOTE_FILL` × that, rounded up to 0.1 s ("Needs a fart near F3 (1.2 s)").
 * The 1e-9 keeps float noise from adding 0.1 s to an exact tenth, as the reference does.
 */
export function neededSeconds(longestNoteSeconds: number): number {
  return Math.ceil(NOTE_FILL * longestNoteSeconds * 10 - 1e-9) / 10
}

/**
 * Cost of the notes a Recording plays too briefly to settle on its pitch. A note sounds for its own
 * length (minus the gap) or for the Recording's own length, whichever is shorter (ADR 0012). Below
 * the Recording's shortest note, each note costs `TOO_SHORT_COST` plus `TOO_SHORT_COST_PER_SECOND`
 * per second it falls short.
 */
export function tooShortCost(
  noteSeconds: readonly number[],
  recordingSeconds: number,
  shortestNoteSeconds: number
): number {
  let cost = 0
  for (const a of noteSeconds) {
    const sounds = Math.min(a, recordingSeconds)
    if (sounds < shortestNoteSeconds) {
      cost += TOO_SHORT_COST + TOO_SHORT_COST_PER_SECOND * (shortestNoteSeconds - sounds)
    }
  }
  return cost
}

/**
 * Cost of the share of each note a Recording plays before it settles on its pitch (#116). A note
 * sounds as in `tooShortCost`; the Recording settles `settleSeconds` after it starts. Each note
 * costs `UNSETTLED_COST` × the share of its sounding time before that, so a short note on a
 * slow-settling fart costs up to 20 and the same fart on a long note costs little.
 */
export function unsettledCost(
  noteSeconds: readonly number[],
  recordingSeconds: number,
  settleSeconds: number
): number {
  let cost = 0
  for (const a of noteSeconds) {
    const sounds = Math.min(a, recordingSeconds)
    cost += (UNSETTLED_COST * Math.min(sounds, settleSeconds)) / Math.max(1e-9, sounds)
  }
  return cost
}

/**
 * Cost of the part of each note a Recording is too short to fill (#205). A note sounds as in
 * `tooShortCost`; the rest of it is silence, which costs `SILENT_COST_PER_SECOND` per second, so a
 * long note prefers a long Recording. The seconds are summed first, with Python's `sum()`, as the
 * reference does.
 */
export function silentCost(noteSeconds: readonly number[], recordingSeconds: number): number {
  return SILENT_COST_PER_SECOND * pythonSum(noteSeconds.map(a => Math.max(0, a - recordingSeconds)))
}

/** Ids compare by code point, as the reference's Python strings do (and UTF-8 bytes). */
export function compareIds(a: string, b: string): number {
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const x = a.codePointAt(i) as number
    const y = b.codePointAt(j) as number
    if (x !== y) return x - y
    i += x > 0xffff ? 2 : 1
    j += y > 0xffff ? 2 : 1
  }
  return a.length - i - (b.length - j)
}

/** Lexicographic order of per-pitch Recording ids, an uncovered pitch after every id. */
function idsPrecede(a: readonly (string | null)[], b: readonly (string | null)[]): boolean {
  for (let k = 0; k < Math.min(a.length, b.length); k++) {
    const x = a[k]
    const y = b[k]
    if (x === y) continue
    if (x === null) return false
    if (y === null) return true
    return compareIds(x, y) < 0
  }
  return a.length < b.length
}

/**
 * Python's `sum()` of floats (3.12 and later, which the reference runs): Neumaier's compensated
 * summation, so a Song pitch's weight in beats is the reference's to the last bit.
 */
function pythonSum(values: readonly number[]): number {
  let sum = 0
  let c = 0
  for (const x of values) {
    const t = sum + x
    c += Math.abs(sum) >= Math.abs(x) ? sum - t + x : x - t + sum
    sum = t
  }
  return c !== 0 && Number.isFinite(c) ? sum + c : sum
}

/** (uncovered pitches, Octave Moves, cost), compared in that order. */
interface Key {
  uncovered: number
  octaves: number
  cost: number
}

/** The allowed moves and their costs under one transposition: cell (pitch i, Recording j). */
class Table {
  readonly rows: number
  readonly columns: number
  readonly allowed: Uint8Array
  readonly isOctaveMove: Uint8Array
  readonly cost: Float64Array

  constructor(
    pitches: readonly number[],
    recordings: readonly AutoMapRecording[],
    t: number,
    weight: readonly number[],
    noteSeconds: readonly number[][],
    longest: readonly number[]
  ) {
    this.rows = pitches.length
    this.columns = recordings.length
    const size = this.rows * this.columns
    this.allowed = new Uint8Array(size)
    this.isOctaveMove = new Uint8Array(size)
    this.cost = new Float64Array(size)
    pitches.forEach((p, i) => {
      recordings.forEach((r, j) => {
        const shift = p + t - (r.recordingPitchMidi as number)
        const move = moveCost(shift)
        if (move === null || !fills(r.gestureSeconds, longest[i])) return
        const cell = i * this.columns + j
        this.allowed[cell] = 1
        this.isOctaveMove[cell] = move.octaveMove ? 1 : 0
        this.cost[cell] =
          weight[i] * move.cost +
          tooShortCost(noteSeconds[i], r.gestureSeconds, r.shortestNoteSeconds as number) +
          (r.settleSeconds === null
            ? 0
            : unsettledCost(noteSeconds[i], r.gestureSeconds, r.settleSeconds)) +
          silentCost(noteSeconds[i], r.gestureSeconds)
      })
    })
  }

  /** The exact key of a choice, cost summed in pitch order. */
  key(choice: readonly (number | null)[]): Key {
    const key: Key = { uncovered: 0, octaves: 0, cost: 0 }
    choice.forEach((j, i) => {
      if (j === null) {
        key.uncovered++
        return
      }
      if (this.isOctaveMove[i * this.columns + j]) key.octaves++
      key.cost += this.cost[i * this.columns + j]
    })
    return key
  }

  /**
   * The best choice for the pitches after `fixed` (Recording indexes or null, in pitch order), as
   * one assignment problem. Penalties larger than any cost make it minimise uncovered pitches
   * first, then Octave Moves, then cost.
   */
  solve(fixed: readonly (number | null)[]): { key: Key; choice: (number | null)[] } {
    const first = fixed.length
    const free: number[] = []
    for (let j = 0; j < this.columns; j++) if (!fixed.includes(j)) free.push(j)
    let bound = 0
    for (let i = first; i < this.rows; i++) {
      let rowMax = 0
      let any = false
      for (let j = 0; j < this.columns; j++) {
        const cell = i * this.columns + j
        if (!this.allowed[cell]) continue
        rowMax = any ? Math.max(rowMax, this.cost[cell]) : this.cost[cell]
        any = true
      }
      bound += rowMax
    }
    const octavePenalty = 1 + bound
    const n = this.rows - first
    const uncoveredPenalty = (n + 1) * octavePenalty
    const m = free.length + n
    const matrix = new Float64Array(n * m).fill(Number.POSITIVE_INFINITY)
    for (let r = 0; r < n; r++) {
      const i = first + r
      free.forEach((j, k) => {
        const cell = i * this.columns + j
        if (this.allowed[cell]) {
          matrix[r * m + k] = this.cost[cell] + (this.isOctaveMove[cell] ? octavePenalty : 0)
        }
      })
      matrix[r * m + free.length + r] = uncoveredPenalty // this pitch stays uncovered
    }
    const choice = [...fixed]
    if (n > 0) {
      for (const k of minimumCost(matrix, n, m)) choice.push(k < free.length ? free[k] : null)
    }
    return { key: this.key(choice), choice }
  }

  /**
   * The lexicographically smallest optimal choice by Recording id (Recordings are sorted by id),
   * an uncovered pitch last.
   */
  smallestIds(isOptimal: (k: Key) => boolean): (number | null)[] {
    const fixed: (number | null)[] = []
    for (let i = 0; i < this.rows; i++) {
      const candidates: (number | null)[] = []
      for (let j = 0; j < this.columns; j++) if (!fixed.includes(j)) candidates.push(j)
      candidates.push(null)
      for (const j of candidates) {
        if (j !== null && !this.allowed[i * this.columns + j]) continue
        if (isOptimal(this.solve([...fixed, j]).key)) {
          fixed.push(j)
          break
        }
      }
    }
    return fixed
  }
}
