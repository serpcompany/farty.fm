import { ANALYSIS_SAMPLE_RATE } from '@/lib/analysis/resample'
import type { Analysis, Trim } from '@/lib/recordings'
import { minimumCost } from './assignment'
import { GAP_SECONDS } from './renderer'
import { type Song, type SongNote, secondsPerBeat } from './song'

const MAXIMUM_SHIFT = 3
const OCTAVE = 12
const OCTAVE_MOVE_COST = 6
const TOO_SHORT_COST = 8
const TOO_SHORT_COST_PER_SECOND = 400
const UNSETTLED_COST = 20
const SILENT_COST_PER_SECOND = 30
export const NOTE_FILL = 1.0
const TIE = 1e-9
const FLOAT_NOISE_IN_TENTHS = 1e-9
export const LOWEST_TRANSPOSITION = -36
export const HIGHEST_TRANSPOSITION = 24

export interface AutoMapRecording {
  id: string
  recordingPitchMidi: number | null
  shortestNoteSeconds: number | null
  gestureSeconds: number
  settleSeconds: number | null
}

export function autoMapRecording(
  id: string,
  analysis: Analysis,
  trim: Trim | null = null
): AutoMapRecording {
  return {
    id,
    recordingPitchMidi: analysis.recordingPitchMidi,
    shortestNoteSeconds: analysis.shortestNoteSeconds,
    gestureSeconds: trimSeconds(
      trim ?? { startSeconds: analysis.gestureStartSeconds, endSeconds: analysis.gestureEndSeconds }
    ),
    settleSeconds: analysis.settleSeconds ?? null
  }
}

export const PLACED_SHORTEST_NOTE_SECONDS = 0.6

export function placedAutoMapRecording(
  id: string,
  analysis: Analysis,
  placedMidi: number,
  trim: Trim | null = null
): AutoMapRecording {
  return {
    ...autoMapRecording(id, analysis, trim),
    recordingPitchMidi: placedMidi,
    shortestNoteSeconds: PLACED_SHORTEST_NOTE_SECONDS,
    settleSeconds: 0
  }
}

export function trimSeconds(trim: Trim): number {
  const sr = ANALYSIS_SAMPLE_RATE
  return (Math.round(trim.endSeconds * sr) - Math.round(trim.startSeconds * sr)) / sr
}

export interface PitchChoice {
  songPitch: number
  targetMidi: number
  recordingId: string | null
  shiftSemitones: number | null
  octaveMove: boolean
}

export interface Arrangement {
  transposition: number
  pitches: PitchChoice[]
  octaveMoves: number
  cost: number
  covered: number
  total: number
  unlocked: boolean
  missingNotes: MissingNote[]
}

export interface MissingNote {
  midi: number
  seconds: number
}

export function arrange(song: Song, recordings: readonly AutoMapRecording[]): Arrangement {
  return arrangePitches(songPitches(song), recordings)
}

export interface SongPitches {
  bpm: number
  pitches: readonly number[]
  durations: readonly (readonly number[])[]
}

export function songPitches(song: Pick<Song, 'bpm'> & { notes: readonly SongNote[] }): SongPitches {
  const pitches = [...new Set(song.notes.map(n => n.pitch))].sort((a, b) => a - b)
  return {
    bpm: song.bpm,
    pitches,
    durations: pitches.map(p => song.notes.filter(n => n.pitch === p).map(n => n.dur))
  }
}

function soundingSeconds(durations: readonly number[], spb: number): number[] {
  return durations.map(dur => Math.max(0, dur * spb - GAP_SECONDS))
}

export function arrangePitches(
  song: SongPitches,
  recordings: readonly AutoMapRecording[]
): Arrangement {
  const melodic = recordings.filter(isMelodic).sort((a, b) => compareIds(a.id, b.id))
  const { pitches } = song
  const spb = secondsPerBeat(song)
  const weight: number[] = []
  const noteSeconds: number[][] = []
  const longest: number[] = []
  for (const durations of song.durations) {
    weight.push(pythonSum(durations))
    noteSeconds.push(soundingSeconds(durations, spb))
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
    if (winner === null || idsPrecede(ids, winner.ids)) winner = { ids, index, choice }
  }
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

export function coveredCount(song: SongPitches, recordings: readonly AutoMapRecording[]): number {
  const melodic = recordings.filter(isMelodic)
  const rows = song.pitches.length
  const columns = melodic.length
  if (columns === 0) return 0
  const spb = secondsPerBeat(song)
  const recordingPitch = melodic.map(r => r.recordingPitchMidi as number)
  const longEnough = song.durations.map(durations => {
    const longest = Math.max(...soundingSeconds(durations, spb))
    return melodic.flatMap((r, j) => (fills(r.gestureSeconds, longest) ? [j] : []))
  })
  const candidates = new Int32Array(rows * columns)
  const count = new Int32Array(rows)
  const owner = new Int32Array(columns)
  const seen = new Int32Array(columns)
  let visit = 0
  const augment = (i: number): boolean => {
    for (let k = 0; k < count[i]; k++) {
      const j = candidates[i * columns + k]
      if (seen[j] === visit) continue
      seen[j] = visit
      if (owner[j] === -1 || augment(owner[j])) {
        owner[j] = i
        return true
      }
    }
    return false
  }

  let best = 0
  for (let t = LOWEST_TRANSPOSITION; t <= HIGHEST_TRANSPOSITION && best < rows; t++) {
    let reachable = 0
    for (let i = 0; i < rows; i++) {
      const target = song.pitches[i] + t
      let n = 0
      for (const j of longEnough[i]) {
        if (inReach(target - recordingPitch[j])) candidates[i * columns + n++] = j
      }
      count[i] = n
      if (n > 0) reachable++
    }
    if (reachable <= best) continue
    owner.fill(-1)
    let matched = 0
    for (let i = 0; i < rows; i++) {
      visit++
      if (augment(i)) matched++
    }
    best = Math.max(best, matched)
  }
  return best
}

export function choiceForSongPitch(arrangement: Arrangement, pitch: number): PitchChoice | null {
  return arrangement.pitches.find(c => c.songPitch === pitch) ?? null
}

function isMelodic(r: AutoMapRecording): boolean {
  return r.recordingPitchMidi !== null && r.shortestNoteSeconds !== null
}

export function moveCost(shift: number): { cost: number; octaveMove: boolean } | null {
  const a = Math.abs(shift)
  if (a <= MAXIMUM_SHIFT) return { cost: a ** 1.5, octaveMove: false }
  if (Math.abs(a - OCTAVE) <= MAXIMUM_SHIFT) {
    return { cost: OCTAVE_MOVE_COST + Math.abs(a - OCTAVE) ** 1.5, octaveMove: true }
  }
  return null
}

function inReach(shift: number): boolean {
  const a = Math.abs(shift)
  return a <= MAXIMUM_SHIFT || Math.abs(a - OCTAVE) <= MAXIMUM_SHIFT
}

export function fills(recordingSeconds: number, longestNoteSeconds: number): boolean {
  return recordingSeconds >= NOTE_FILL * longestNoteSeconds
}

export function neededSeconds(longestNoteSeconds: number): number {
  return Math.max(0, Math.ceil(NOTE_FILL * longestNoteSeconds * 10 - FLOAT_NOISE_IN_TENTHS) / 10)
}

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

export function silentCost(noteSeconds: readonly number[], recordingSeconds: number): number {
  return SILENT_COST_PER_SECOND * pythonSum(noteSeconds.map(a => Math.max(0, a - recordingSeconds)))
}

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

interface Key {
  uncovered: number
  octaves: number
  cost: number
}

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
      const stayUncovered = free.length + r
      matrix[r * m + stayUncovered] = uncoveredPenalty
    }
    const choice = [...fixed]
    if (n > 0) {
      for (const k of minimumCost(matrix, n, m)) choice.push(k < free.length ? free[k] : null)
    }
    return { key: this.key(choice), choice }
  }

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
      if (fixed.length === i) throw new Error(`Auto-map found no optimal choice for pitch ${i}`)
    }
    return fixed
  }
}
