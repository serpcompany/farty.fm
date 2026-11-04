import {
  type Arrangement,
  type AutoMapRecording,
  choiceForSongPitch,
  compareIds,
  isMelodic,
  type PitchChoice,
  pitchNotes,
  type SongPitches,
  neededSeconds as secondsNeeded
} from '@/lib/engine/auto-map'
import {
  arrangeChoices,
  bringBackFart,
  canPlay,
  type FartChoices,
  leaveOutFart,
  noChoices,
  resetPitch,
  sameFartChoices,
  swapFart
} from '@/lib/engine/fart-choices'
import { noteName } from '@/lib/pitch'

// Song Creator's fart sheet (#360): for one of a Song's pitches, every fart of the user's that can
// play it, how the Arrangement uses each, and what each change says once it's made. The changes
// themselves are `engine/fart-choices.ts`'s, matched to the reference.

/** A fart that can play the sheet's pitch. */
export type FartRow = {
  id: string
  /** The fart's own note: its Recording Pitch, or the note it was placed on (ADR 0015). */
  note: number
  /** The note it would play minus its own, in semitones: above 0 when the fart is lower. */
  shift: number
  /** The Arrangement picks it for this pitch when the user has swapped nothing in. */
  isFartysPick: boolean
  /** It plays this pitch because the user swapped it in. */
  isYourPick: boolean
  /** The Song pitch it plays now, when that's another one. */
  playsPitch: number | null
  /** The note that other pitch sounds at. */
  playsNote: number | null
}

/** What the fart sheet shows for one pitch of a Song. */
export type FartSheet = {
  /** The Song's pitch, before transposition. */
  songPitch: number
  /** The note it sounds at in the Toot. */
  note: number
  /** How many of the Song's notes are at this pitch. */
  noteCount: number
  /** The fart that plays it now; null when none does. */
  inUse: FartRow | null
  /** The farts nobody plays, closest to the note first. */
  free: FartRow[]
  /** The farts other pitches play, closest first. */
  others: FartRow[]
  /** The farts left out of this Song that could play it, closest first. */
  leftOut: FartRow[]
  /** Leaving out the fart in use leaves this pitch with none: the Song locks. */
  isOnlyFart: boolean
  /** This pitch has a change that Reset to automatic undoes. */
  hasChange: boolean
  /** How long a fart must last to play it, rounded up to 0.1 s. */
  neededSeconds: number
}

/** How far a fart is from the note, for ordering: on the note, 1 to 3 semitones, octave moves. */
function distance(shift: number): number {
  const d = Math.abs(shift)
  return d <= 3 ? d : 10 + Math.abs(d - 12)
}

/** Every fart that can play `songPitch`, as the sheet lists them. */
export function fartSheet(
  song: SongPitches,
  recordings: readonly AutoMapRecording[],
  choices: FartChoices | null,
  songPitch: number
): FartSheet {
  const arrangement = arrangeChoices(song, recordings, choices)
  const t = arrangement.transposition
  const i = song.pitches.indexOf(songPitch)
  const note = songPitch + t
  // What the Arrangement picks with no swap: the left-out farts stay out.
  const fartys = choices ? arrangeChoices(song, recordings, { ...choices, preferred: {} }) : null
  const fartysPick = (fartys ?? arrangement).pitches.find(c => c.songPitch === songPitch)
  const playing = new Map<string, PitchChoice>()
  for (const c of arrangement.pitches) if (c.recordingId) playing.set(c.recordingId, c)
  const excluded = new Set(choices?.excluded ?? [])
  const inUseId = choiceForSongPitch(arrangement, songPitch)?.recordingId ?? null

  const rows: FartRow[] = recordings
    .filter(r => isMelodic(r) && canPlay(r, songPitch, song, t))
    .map(r => {
      const other = playing.get(r.id)
      const plays = other && other.songPitch !== songPitch ? other : null
      return {
        id: r.id,
        note: r.recordingPitchMidi as number,
        shift: note - (r.recordingPitchMidi as number),
        isFartysPick: fartysPick?.recordingId === r.id,
        isYourPick: r.id === inUseId && choices?.preferred[songPitch] === r.id,
        playsPitch: plays?.songPitch ?? null,
        playsNote: plays?.targetMidi ?? null
      }
    })
    .sort(
      (a, b) =>
        distance(a.shift) - distance(b.shift) ||
        Number(b.isFartysPick) - Number(a.isFartysPick) ||
        compareIds(a.id, b.id)
    )

  const inUse = rows.find(r => r.id === inUseId) ?? null
  const current = choices ?? noChoices(t)
  const without = inUse ? arrangeChoices(song, recordings, leaveOutFart(current, inUse.id)) : null
  return {
    songPitch,
    note,
    noteCount: i < 0 ? 0 : song.durations[i].length,
    inUse,
    free: rows.filter(r => r !== inUse && !excluded.has(r.id) && r.playsPitch === null),
    others: rows.filter(r => !excluded.has(r.id) && r.playsPitch !== null),
    leftOut: rows.filter(r => excluded.has(r.id)),
    isOnlyFart: without !== null && !choiceForSongPitch(without, songPitch)?.recordingId,
    hasChange:
      choices !== null &&
      !sameFartChoices(resetPitch(choices, songPitch, song, recordings), choices),
    neededSeconds: i < 0 ? 0 : secondsNeeded(pitchNotes(song)[i].longest)
  }
}

/**
 * "on the note", "1 semitone low", "2 semitones high", "an octave low", "an octave and 1 low", or
 * for a fart less than an octave away, "11 semitones high". Low when the fart is below the note.
 */
export function noteDistance(shift: number): string {
  const d = Math.abs(shift)
  if (d === 0) return 'on the note'
  const side = shift > 0 ? 'low' : 'high'
  if (d === 12) return `an octave ${side}`
  if (d > 12) return `an octave and ${d - 12} ${side}`
  return `${d} ${d === 1 ? 'semitone' : 'semitones'} ${side}`
}

/** One change the user makes to a Song's farts in Song Creator. */
export type FartChange =
  /** The fart `id` plays `songPitch`. */
  | { kind: 'swap'; songPitch: number; id: string }
  /** The fart `id`, which plays `songPitch`, plays nothing in this Song. */
  | { kind: 'leaveOut'; songPitch: number; id: string }
  /** `songPitch` back to Farty's pick. */
  | { kind: 'reset'; songPitch: number }
  /** The left-out fart `id` may play in this Song again. */
  | { kind: 'useAgain'; id: string }
  /** Every change undone: the Song is automatic. */
  | { kind: 'resetAll' }

/** The Song's Fart Choices once `change` is made: null when the Song is automatic again. */
export function changedChoices(
  change: FartChange,
  song: SongPitches,
  recordings: readonly AutoMapRecording[],
  choices: FartChoices | null
): FartChoices | null {
  const current = choices ?? noChoices(arrangeChoices(song, recordings, null).transposition)
  switch (change.kind) {
    case 'swap':
      return swapFart(current, change.songPitch, change.id)
    case 'leaveOut':
      return leaveOutFart(current, change.id)
    case 'reset':
      return resetPitch(current, change.songPitch, song, recordings)
    case 'useAgain':
      return bringBackFart(current, change.id)
    case 'resetAll':
      return null
  }
}

/**
 * What a change did, as the line under Play says it: "C♯3 now uses Recording 12. D3 now uses
 * Recording 7.", naming the change's own pitch first, then every other pitch whose fart moved.
 * `name` names a Recording by id: "Recording 12".
 */
export function changeLine(
  change: FartChange,
  before: Arrangement,
  after: Arrangement,
  name: (id: string) => string
): string {
  const was = new Map(before.pitches.map(c => [c.songPitch, c.recordingId]))
  const own = 'songPitch' in change ? change.songPitch : null
  const now = (c: PitchChoice) =>
    c.recordingId
      ? `${noteName(c.targetMidi)} now uses ${name(c.recordingId)}.`
      : `${noteName(c.targetMidi)} has no fart.`
  const moved = after.pitches.filter(
    c => c.songPitch !== own && was.get(c.songPitch) !== c.recordingId
  )
  const ownChoice = own === null ? undefined : choiceForSongPitch(after, own)
  const ownNote = ownChoice ? noteName(ownChoice.targetMidi) : ''
  switch (change.kind) {
    case 'swap':
      return [ownChoice ? now(ownChoice) : '', ...moved.map(now)].filter(Boolean).join(' ')
    case 'leaveOut':
      return [
        `${name(change.id)} is left out of this Song.`,
        ...(ownChoice ? [now(ownChoice)] : []),
        ...moved.map(now)
      ].join(' ')
    case 'reset':
      return [`${ownNote} is back to Farty's pick.`, ...moved.map(now)].join(' ')
    case 'useAgain':
      return [`${name(change.id)} can play in this Song again.`, ...moved.map(now)].join(' ')
    case 'resetAll':
      return "Every note is back to Farty's pick."
  }
}
