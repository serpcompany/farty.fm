import {
  defaultName,
  foundNote,
  foundPart,
  isNoiseLike,
  isPlaceablePitch,
  MAXIMUM_NAME_LENGTH,
  NO_NOTE,
  type Recording,
  samePart,
  type Trim,
  trimHandles
} from './recordings'

// A take's review (#314): the one screen after Stop, and from a Recording's pencil later, where the
// user trims the fart, gives it a note or "No note", and names it. What it shows and what its Save
// changes, apart from the screen.

/**
 * The note the user picked on the review: a MIDI note, "No note", or null to follow analysis: the
 * note it finds, or none.
 */
export type NoteChoice = number | 'none' | null

/** What the review's note says: still finding it, a note, or "No note". */
export type ReviewNote = { kind: 'finding' } | { kind: 'note'; midi: number } | { kind: 'none' }

/** What the review shows for `choice` on a take analyzed as far as `recording` says. */
export function reviewNote(recording: Recording, choice: NoteChoice): ReviewNote {
  if (choice === 'none') return { kind: 'none' }
  if (choice !== null) return { kind: 'note', midi: choice }
  if (recording.analysis.state === 'analyzing') return { kind: 'finding' }
  const found = foundNote(recording)
  return found === null ? { kind: 'none' } : { kind: 'note', midi: found }
}

/** The choice a saved Recording's review opens on: its Placed Pitch, "No note", or analysis. */
export function savedChoice(recording: Recording): NoteChoice {
  const { placedPitch } = recording
  if (placedPitch === NO_NOTE) return 'none'
  return isPlaceablePitch(placedPitch) ? placedPitch : null
}

/** A key tapped: that note, or analysis again when it is the note analysis found. */
export function choiceForKey(recording: Recording, midi: number): NoteChoice {
  return foundNote(recording) === midi ? null : midi
}

/**
 * "No note" tapped: "No note", or, when it already is, back to what analysis finds. When analysis
 * found no note, it stays: a key gives it one.
 */
export function choiceForNoNote(recording: Recording, choice: NoteChoice): NoteChoice {
  if (reviewNote(recording, choice).kind !== 'none') return 'none'
  return reviewNote(recording, null).kind === 'none' ? choice : null
}

/**
 * The Placed Pitch Save keeps for `choice` (ADR 0015): null to follow analysis, a note, or
 * `NO_NOTE` to leave a fart out of Songs though analysis found, or may find, a note. A Noise-like
 * one is out of Songs without it.
 */
export function placedPitchFor(recording: Recording, choice: NoteChoice): number | null {
  if (choice === null) return null
  if (choice === 'none') return isNoiseLike(recording) ? null : NO_NOTE
  return foundNote(recording) === choice ? null : choice
}

/**
 * What the review's handles open on, and Reset goes back to: the fart analysis found, or the
 * whole take while it's still finding it, or found none.
 */
export function foundHandles(recording: Recording): Trim {
  return foundPart(recording) ?? { startSeconds: 0, endSeconds: recording.seconds }
}

/** Where the review's handles open: the Trim's, or else the fart analysis found. */
export function openingHandles(recording: Recording): Trim {
  return trimHandles(recording) ?? foundHandles(recording)
}

/**
 * What Save does with the Trim (ADR 0019): nothing when the handles are where it opened them,
 * null to take a Trim off when they're back on the fart analysis found, or else the new handles.
 */
export function trimChange(recording: Recording, handles: Trim): Trim | null | undefined {
  if (samePart(handles, openingHandles(recording))) return undefined
  return samePart(handles, foundHandles(recording)) ? null : handles
}

/** The name Save keeps for what's typed: null when it's empty or the default "Recording 12". */
export function nameFor(typed: string, number: number): string | null {
  const name = typed.trim().slice(0, MAXIMUM_NAME_LENGTH)
  return name === '' || name === defaultName(number) ? null : name
}

/** What a review's Save changes on a Recording: each field it leaves out stays as it is. */
export type ReviewChange = {
  placedPitch?: number | null
  handles?: Trim | null
  name?: string | null
}

/** What the review changes on `recording`, from where the user left the note, handles and name. */
export function reviewChange(
  recording: Recording,
  review: { choice: NoteChoice; handles: Trim; name: string }
): ReviewChange {
  const change: ReviewChange = {}
  if (review.choice !== savedChoice(recording)) {
    const placedPitch = placedPitchFor(recording, review.choice)
    if (placedPitch !== (recording.placedPitch ?? null)) change.placedPitch = placedPitch
  }
  const handles = trimChange(recording, review.handles)
  if (handles !== undefined) change.handles = handles
  const name = nameFor(review.name, recording.number)
  if (name !== (recording.name ?? null)) change.name = name
  return change
}
