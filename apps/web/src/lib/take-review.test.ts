import { describe, expect, it } from 'vitest'
import { type Analysis, NO_NOTE, type Recording } from './recordings'
import {
  choiceForKey,
  choiceForNoNote,
  foundHandles,
  nameFor,
  openingHandles,
  placedPitchFor,
  reviewChange,
  reviewNote,
  savedChoice,
  trimChange
} from './take-review'

// The take's review (#314): what its note says, and what its Save changes.

const analysis: Analysis = {
  gestureStartSeconds: 0.2,
  gestureEndSeconds: 1.1,
  cutAtReattack: false,
  pitchEstimateMidi: 55.3,
  pitchConfidence: 0.9,
  recordingPitchMidi: 55.3,
  shortestNoteSeconds: 0.12,
  settleSeconds: 0.04
}

/** A 1.5 s take analyzed as Melodic, G3 (55.3), its fart 0.2 to 1.1 s. */
const melodic = (fields: Partial<Recording> = {}): Recording => ({
  id: 'r',
  number: 12,
  createdAt: 0,
  seconds: 1.5,
  sampleRate: 48_000,
  waveform: [],
  analysis: { state: 'analyzed', analysis },
  ...fields
})
const noiseLike = (fields: Partial<Recording> = {}): Recording =>
  melodic({
    analysis: {
      state: 'analyzed',
      analysis: { ...analysis, recordingPitchMidi: null, shortestNoteSeconds: null }
    },
    ...fields
  })
const finding = (fields: Partial<Recording> = {}): Recording =>
  melodic({ analysis: { state: 'analyzing' }, ...fields })

describe('the review’s note', () => {
  it('is "Finding note…" until analysis lands, then the note it found or "No note"', () => {
    expect(reviewNote(finding(), null)).toEqual({ kind: 'finding' })
    expect(reviewNote(melodic(), null)).toEqual({ kind: 'note', midi: 55 })
    expect(reviewNote(noiseLike(), null)).toEqual({ kind: 'none' })
    // Analysis failed: it couldn't find the note, which isn't "No note".
    expect(reviewNote(melodic({ analysis: { state: 'notAnalyzed' } }), null)).toEqual({
      kind: 'notFound'
    })
    // What the user picked shows at once, finding or not.
    expect(reviewNote(finding(), 43)).toEqual({ kind: 'note', midi: 43 })
    expect(reviewNote(melodic(), 'none')).toEqual({ kind: 'none' })
  })

  it('makes a key the note, or follows analysis again on the note it found', () => {
    expect(choiceForKey(melodic(), 43)).toBe(43)
    expect(choiceForKey(melodic(), 55)).toBeNull()
    // Still finding, any key is the user's.
    expect(choiceForKey(finding(), 55)).toBe(55)
    expect(choiceForKey(noiseLike(), 48)).toBe(48)
  })

  it('turns "No note" on, and off again back to the note analysis found', () => {
    expect(choiceForNoNote(melodic(), null)).toBe('none')
    expect(choiceForNoNote(melodic(), 43)).toBe('none')
    expect(choiceForNoNote(melodic(), 'none')).toBeNull()
    expect(choiceForNoNote(finding(), 'none')).toBeNull()
    // Noise-like is "No note" already: a key gives it a note.
    expect(choiceForNoNote(noiseLike(), null)).toBeNull()
    expect(choiceForNoNote(noiseLike(), 48)).toBe('none')
  })

  it('opens a saved Recording on its Placed Pitch, its "No note", or analysis', () => {
    expect(savedChoice(melodic())).toBeNull()
    expect(savedChoice(melodic({ placedPitch: null }))).toBeNull()
    expect(savedChoice(melodic({ placedPitch: 43 }))).toBe(43)
    expect(savedChoice(melodic({ placedPitch: NO_NOTE }))).toBe('none')
  })

  it('keeps a Placed Pitch only where it differs from analysis', () => {
    expect(placedPitchFor(melodic(), null)).toBeNull()
    expect(placedPitchFor(melodic(), 43)).toBe(43)
    expect(placedPitchFor(melodic(), 55)).toBeNull()
    expect(placedPitchFor(melodic(), 'none')).toBe(NO_NOTE)
    // Saved while finding, it keeps what the user picked.
    expect(placedPitchFor(finding(), 55)).toBe(55)
    expect(placedPitchFor(finding(), 'none')).toBe(NO_NOTE)
    // Noise-like is out of Songs without it.
    expect(placedPitchFor(noiseLike(), 'none')).toBeNull()
    expect(placedPitchFor(noiseLike(), 48)).toBe(48)
  })
})

describe('the review’s handles', () => {
  const trim = {
    startSeconds: 0.4,
    endSeconds: 0.9,
    fart: { startSeconds: 0.42, endSeconds: 0.88 }
  }

  it('open on the Trim, or the fart analysis found, or the whole take while finding', () => {
    expect(openingHandles(melodic())).toEqual({ startSeconds: 0.2, endSeconds: 1.1 })
    expect(openingHandles(melodic({ trim }))).toEqual({ startSeconds: 0.4, endSeconds: 0.9 })
    expect(openingHandles(finding())).toEqual({ startSeconds: 0, endSeconds: 1.5 })
    expect(foundHandles(melodic({ trim }))).toEqual({ startSeconds: 0.2, endSeconds: 1.1 })
  })

  it('trim a Melodic Recording, keep a Trim, and take it off back on the fart found', () => {
    const moved = { startSeconds: 0.3, endSeconds: 0.8 }
    expect(trimChange(melodic(), moved)).toEqual(moved)
    expect(trimChange(melodic(), { startSeconds: 0.2, endSeconds: 1.1 })).toBeUndefined()
    expect(trimChange(melodic({ trim }), { startSeconds: 0.4, endSeconds: 0.9 })).toBeUndefined()
    expect(trimChange(melodic({ trim }), { startSeconds: 0.2, endSeconds: 1.1 })).toBeNull()
    // A new take's handles moved before analysis lands are kept.
    expect(trimChange(finding(), moved)).toEqual(moved)
    expect(trimChange(finding(), { startSeconds: 0, endSeconds: 1.5 })).toBeUndefined()
  })
})

describe('the review’s Save', () => {
  it('keeps no name for an empty one or the default, and at most 40 characters', () => {
    expect(nameFor('  ', 12)).toBeNull()
    expect(nameFor('Recording 12', 12)).toBeNull()
    expect(nameFor(' Recording 3 ', 12)).toBe('Recording 3')
    expect(nameFor('x'.repeat(45), 12)).toBe('x'.repeat(40))
  })

  it('changes only what the user changed', () => {
    const left = {
      choice: null,
      handles: { startSeconds: 0.2, endSeconds: 1.1 },
      name: 'Recording 12'
    }
    expect(reviewChange(melodic(), left)).toEqual({})
    expect(
      reviewChange(melodic(), {
        choice: 43,
        handles: { startSeconds: 0.3, endSeconds: 0.8 },
        name: 'Squeaker'
      })
    ).toEqual({
      placedPitch: 43,
      handles: { startSeconds: 0.3, endSeconds: 0.8 },
      name: 'Squeaker'
    })
    // Back to analysis, "Recording 12" again, untrimmed.
    const placed = melodic({
      placedPitch: 43,
      name: 'Squeaker',
      trim: { startSeconds: 0.3, endSeconds: 0.8, fart: { startSeconds: 0.3, endSeconds: 0.8 } }
    })
    expect(reviewChange(placed, left)).toEqual({ placedPitch: null, handles: null, name: null })
    // "No note" on a Melodic Recording keeps it out of Songs.
    expect(reviewChange(melodic(), { ...left, choice: 'none' })).toEqual({ placedPitch: NO_NOTE })
    // Opened on a Placed Pitch that is the note analysis later found, it stays unless changed.
    expect(reviewChange(melodic({ placedPitch: 55 }), { ...left, choice: 55 })).toEqual({})
  })
})
