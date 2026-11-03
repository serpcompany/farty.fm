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

export type NoteChoice = number | 'none' | null

export type ReviewNote =
  | { kind: 'finding' }
  | { kind: 'note'; midi: number }
  | { kind: 'none' }
  | { kind: 'notFound' }

export function reviewNote(recording: Recording, choice: NoteChoice): ReviewNote {
  if (choice === 'none') return { kind: 'none' }
  if (choice !== null) return { kind: 'note', midi: choice }
  if (recording.analysis.state === 'analyzing') return { kind: 'finding' }
  if (recording.analysis.state === 'notAnalyzed') return { kind: 'notFound' }
  const found = foundNote(recording)
  return found === null ? { kind: 'none' } : { kind: 'note', midi: found }
}

export function savedChoice(recording: Recording): NoteChoice {
  const { placedPitch } = recording
  if (placedPitch === NO_NOTE) return 'none'
  return isPlaceablePitch(placedPitch) ? placedPitch : null
}

export function choiceForKey(recording: Recording, midi: number): NoteChoice {
  return foundNote(recording) === midi ? null : midi
}

export function choiceForNoNote(recording: Recording, choice: NoteChoice): NoteChoice {
  if (reviewNote(recording, choice).kind !== 'none') return 'none'
  return reviewNote(recording, null).kind === 'none' ? choice : null
}

export function placedPitchFor(recording: Recording, choice: NoteChoice): number | null {
  if (choice === null) return null
  if (choice === 'none') return isNoiseLike(recording) ? null : NO_NOTE
  return foundNote(recording) === choice ? null : choice
}

export function foundHandles(recording: Recording): Trim {
  return foundPart(recording) ?? { startSeconds: 0, endSeconds: recording.seconds }
}

export function openingHandles(recording: Recording): Trim {
  return trimHandles(recording) ?? foundHandles(recording)
}

export function trimChange(recording: Recording, handles: Trim): Trim | null | undefined {
  if (samePart(handles, openingHandles(recording))) return undefined
  return samePart(handles, foundHandles(recording)) ? null : handles
}

export function nameFor(typed: string, number: number): string | null {
  const name = typed.trim().slice(0, MAXIMUM_NAME_LENGTH)
  return name === '' || name === defaultName(number) ? null : name
}

export type ReviewChange = {
  placedPitch?: number | null
  handles?: Trim | null
  name?: string | null
}

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
