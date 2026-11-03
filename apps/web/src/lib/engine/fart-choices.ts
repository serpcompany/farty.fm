import {
  type Arrangement,
  type AutoMapRecording,
  arrangePitches,
  compareIds,
  isMelodic,
  neededSeconds,
  type PitchChoice,
  pitchCell,
  pitchNotes,
  type SongPitches
} from './auto-map'

// Fart Choices (#360): the user's changes to one Song's Arrangement, the fart they swapped in for a
// pitch and the farts they left out of the Song. A port of the reference's `FartChoices`,
// `arrange()` and the changes beside them (`tools/melody-lab/engine.py`), checked against its
// `fixtures/golden/choices.json`. The user still can't change the Song's notes (ADR 0005).

/**
 * A Song's Fart Choices, kept with the transposition the Song had when the first change was made,
 * which holds while any change stands, so changing a fart never moves the Song to another key. A
 * Song with none is arranged by Auto-map alone. Plain data: stored in the browser and on the account
 * as it is.
 */
export interface FartChoices {
  /** Semitones the Song is moved by while it has a change. */
  transposition: number
  /** The Recording the user swapped in for a Song pitch (MIDI, in the score's key). */
  preferred: Record<number, string>
  /** The Recordings left out of this Song, sorted by id. */
  excluded: string[]
}

/** No change yet, at `transposition`: where the first change starts. */
export function noChoices(transposition: number): FartChoices {
  return { transposition, preferred: {}, excluded: [] }
}

/** The Song pitches the user picked a fart for, lowest first, with that fart. */
function picks(choices: FartChoices): [number, string][] {
  return Object.entries(choices.preferred)
    .map(([pitch, id]): [number, string] => [Number(pitch), id])
    .sort((a, b) => a[0] - b[0])
}

/** The Choices as kept, or null once nothing is changed: the Song is automatic again. */
function settled(transposition: number, preferred: [number, string][], excluded: string[]) {
  if (preferred.length === 0 && excluded.length === 0) return null
  return {
    transposition,
    preferred: Object.fromEntries(preferred.sort((a, b) => a[0] - b[0])),
    excluded: [...new Set(excluded)].sort(compareIds)
  }
}

/**
 * Whether Melodic `recording` may play Song pitch `pitch` at the Choices' transposition: near
 * enough to it and long enough for its longest note.
 */
export function canPlay(
  recording: AutoMapRecording,
  pitch: number,
  song: SongPitches,
  transposition: number
): boolean {
  const i = song.pitches.indexOf(pitch)
  if (i < 0 || !isMelodic(recording)) return false
  return pitchCell(recording, pitch + transposition, pitchNotes(song)[i]) !== null
}

/** `id` plays `pitch`: picked for it, taken from any other pitch it was picked for, and no longer left out. */
export function swapFart(choices: FartChoices, pitch: number, id: string): FartChoices | null {
  const preferred = picks(choices).filter(([, r]) => r !== id)
  return settled(
    choices.transposition,
    [...preferred, [pitch, id]],
    choices.excluded.filter(r => r !== id)
  )
}

/** `id` plays nothing in this Song, and a pitch it was picked for is Farty's pick again. */
export function leaveOutFart(choices: FartChoices, id: string): FartChoices | null {
  return settled(
    choices.transposition,
    picks(choices).filter(([, r]) => r !== id),
    [...choices.excluded, id]
  )
}

/** `id`, left out, may play in this Song again: the reference's `use_again()`. */
export function bringBackFart(choices: FartChoices, id: string): FartChoices | null {
  return settled(
    choices.transposition,
    picks(choices),
    choices.excluded.filter(r => r !== id)
  )
}

/**
 * `pitch` back to Farty's pick: its own pick cleared, and every left-out Recording that could play
 * it may play again. A left-out Recording that is gone stays left out.
 */
export function resetPitch(
  choices: FartChoices,
  pitch: number,
  song: SongPitches,
  recordings: readonly AutoMapRecording[]
): FartChoices | null {
  const byId = new Map(recordings.map(r => [r.id, r]))
  return settled(
    choices.transposition,
    picks(choices).filter(([p]) => p !== pitch),
    choices.excluded.filter(id => {
      const r = byId.get(id)
      return !(r && canPlay(r, pitch, song, choices.transposition))
    })
  )
}

/**
 * The Song's Arrangement with its Fart Choices: Auto-map's when there are none. With Choices, at
 * their transposition T:
 * 1. Auto-map's Arrangement at T, on every Recording, is the base.
 * 2. Each picked Recording plays its pitch, lowest pitch first. A pick is dropped when its pitch
 *    isn't in the Song, its Recording is gone, Noise-like, left out or picked for a lower pitch
 *    already, or can't play the pitch at T.
 * 3. Every other pitch keeps its base Recording unless that one is left out or picked.
 * 4. The pitches left over are arranged by Auto-map at T on just their notes and the Melodic
 *    Recordings nobody plays and nobody left out, ranked as any Arrangement is. One no Recording
 *    can play stays uncovered, and the Song locks.
 * The cost and Octave Moves are summed in ascending pitch order, as Auto-map sums them.
 */
export function arrangeChoices(
  song: SongPitches,
  recordings: readonly AutoMapRecording[],
  choices: FartChoices | null
): Arrangement {
  if (choices === null) return arrangePitches(song, recordings)
  const t = choices.transposition
  const notes = pitchNotes(song)
  const melodic = new Map(recordings.filter(isMelodic).map(r => [r.id, r]))
  const excluded = new Set(choices.excluded)
  const base = arrangePitches(song, recordings, t)
  const index = new Map(song.pitches.map((p, i) => [p, i]))

  const chosen = new Map<number, string | null>()
  const playing = new Set<string>()
  for (const [pitch, id] of picks(choices)) {
    const i = index.get(pitch)
    const r = melodic.get(id)
    if (i === undefined || !r || excluded.has(id) || playing.has(id)) continue
    if (pitchCell(r, pitch + t, notes[i]) === null) continue
    chosen.set(pitch, id)
    playing.add(id)
  }
  const picked = new Set(playing)
  for (const c of base.pitches) {
    const id = c.recordingId
    if (chosen.has(c.songPitch) || id === null || excluded.has(id) || picked.has(id)) continue
    chosen.set(c.songPitch, id)
    playing.add(id)
  }
  const free = song.pitches.flatMap((p, i) => (chosen.has(p) ? [] : [i]))
  if (free.length > 0) {
    const rest = arrangePitches(
      {
        bpm: song.bpm,
        pitches: free.map(i => song.pitches[i]),
        durations: free.map(i => song.durations[i])
      },
      [...melodic.values()].filter(r => !playing.has(r.id) && !excluded.has(r.id)),
      t
    )
    for (const c of rest.pitches) chosen.set(c.songPitch, c.recordingId)
  }

  let octaveMoves = 0
  let cost = 0
  const pitches = song.pitches.map((p, i): PitchChoice => {
    const id = chosen.get(p) ?? null
    const r = id === null ? undefined : melodic.get(id)
    if (id === null || !r) {
      return {
        songPitch: p,
        targetMidi: p + t,
        recordingId: null,
        shiftSemitones: null,
        octaveMove: false
      }
    }
    const cell = pitchCell(r, p + t, notes[i])
    if (cell === null) throw new Error(`Recording ${id} can't play ${p + t}`)
    if (cell.octaveMove) octaveMoves++
    cost += cell.cost
    return {
      songPitch: p,
      targetMidi: p + t,
      recordingId: id,
      shiftSemitones: p + t - (r.recordingPitchMidi as number),
      octaveMove: cell.octaveMove
    }
  })
  const covered = pitches.filter(c => c.recordingId !== null).length
  return {
    transposition: t,
    pitches,
    octaveMoves,
    cost,
    covered,
    total: pitches.length,
    unlocked: covered === pitches.length,
    missingNotes: pitches.flatMap((c, i) =>
      c.recordingId === null
        ? [{ midi: c.targetMidi, seconds: neededSeconds(notes[i].longest) }]
        : []
    )
  }
}
