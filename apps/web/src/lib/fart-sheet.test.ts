import { describe, expect, it } from 'vitest'
import { autoMapInput, goldenSong, libraries } from '@/test-support/engine-golden'
import { arrangePitches, choiceForSongPitch, songPitches } from './engine/auto-map'
import {
  arrangeChoices,
  canPlay,
  type FartChoices,
  noChoices,
  swapFart
} from './engine/fart-choices'
import { changedChoices, changeLine, type FartSheet, fartSheet, noteDistance } from './fart-sheet'
import { noteName } from './pitch'

// Song Creator's fart sheet (#360) over the golden library: what it lists for a pitch, and what
// each change does and says. The changes are `engine/fart-choices.ts`'s, matched to the reference
// in `fart-choices.test.ts`; these check the sheet around them.

const recordings = libraries.full.map(autoMapInput)
const song = songPitches(goldenSong('twinkle'))
const auto = arrangePitches(song, recordings)
const name = (id: string) => `Recording ${id}`

/** Every row the sheet lists, in its order. */
const rowsOf = (sheet: FartSheet) => [
  ...(sheet.inUse ? [sheet.inUse] : []),
  ...sheet.free,
  ...sheet.others,
  ...sheet.leftOut
]

describe('the fart sheet', () => {
  it('lists every fart that can play the pitch once, in use, free or playing another note', () => {
    for (const pitch of song.pitches) {
      const sheet = fartSheet(song, recordings, null, pitch)
      const canPlayIt = recordings
        .filter(r => r.recordingPitchMidi !== null && canPlay(r, pitch, song, auto.transposition))
        .map(r => r.id)
      expect(
        rowsOf(sheet)
          .map(r => r.id)
          .sort()
      ).toEqual([...canPlayIt].sort())
      expect(sheet.inUse?.id).toBe(choiceForSongPitch(auto, pitch)?.recordingId)
      expect(sheet.inUse?.isFartysPick).toBe(true)
      expect(sheet.leftOut).toEqual([])
      expect(sheet.hasChange).toBe(false)
      expect(sheet.note).toBe(pitch + auto.transposition)
      for (const row of sheet.free) expect(row.playsPitch).toBeNull()
      for (const row of sheet.others) {
        expect(row.playsPitch).not.toBe(pitch)
        expect(choiceForSongPitch(auto, row.playsPitch as number)?.recordingId).toBe(row.id)
        expect(row.playsNote).toBe((row.playsPitch as number) + auto.transposition)
      }
    }
  })

  it('names each fart’s nearest note, and how many whole semitones it is from the pitch', () => {
    const pitchOf = new Map(recordings.map(r => [r.id, r.recordingPitchMidi as number]))
    // The golden library's Recording Pitches are measured, so most fall between two notes.
    expect([...pitchOf.values()].some(p => p !== null && !Number.isInteger(p))).toBe(true)
    for (const pitch of song.pitches) {
      const sheet = fartSheet(song, recordings, null, pitch)
      for (const row of rowsOf(sheet)) {
        expect(row.note).toBe(Math.floor((pitchOf.get(row.id) as number) + 0.5))
        expect(row.shift).toBe(sheet.note - row.note)
      }
    }
  })

  it('puts the closest farts first, an octave away after any within 3 semitones', () => {
    const away = (shift: number) => (Math.abs(shift) <= 3 ? Math.abs(shift) : 10)
    for (const pitch of song.pitches) {
      const sheet = fartSheet(song, recordings, null, pitch)
      for (const group of [sheet.free, sheet.others]) {
        const order = group.map(r => away(r.shift))
        expect(order).toEqual([...order].sort((a, b) => a - b))
      }
    }
  })

  it('shows a swapped-in fart as your pick, and Farty’s among the rest', () => {
    const pitch = song.pitches[0]
    const before = fartSheet(song, recordings, null, pitch)
    const other = before.free[0] ?? before.others[0]
    const choices = changedChoices(
      { kind: 'swap', songPitch: pitch, id: other.id },
      song,
      recordings,
      null
    ) as FartChoices
    const after = fartSheet(song, recordings, choices, pitch)
    expect(after.inUse).toMatchObject({ id: other.id, isYourPick: true, isFartysPick: false })
    expect(after.hasChange).toBe(true)
    const fartys = rowsOf(after).find(r => r.isFartysPick)
    expect(fartys?.id).toBe(before.inUse?.id)
  })

  it('moves a left-out fart to its own group, and locks a pitch it was the only fart for', () => {
    const pitch = song.pitches[0]
    const sheet = fartSheet(song, recordings, null, pitch)
    const id = sheet.inUse?.id as string
    const choices = changedChoices(
      { kind: 'leaveOut', songPitch: pitch, id },
      song,
      recordings,
      null
    ) as FartChoices
    const after = fartSheet(song, recordings, choices, pitch)
    expect(after.leftOut.map(r => r.id)).toEqual([id])
    expect(after.inUse?.id).not.toBe(id)
    expect(after.hasChange).toBe(true)
    expect(sheet.isOnlyFart).toBe(after.inUse === null)

    // Leave out every fart but one that can play the pitch: that one is then its only fart.
    const others = rowsOf(after).filter(r => r.id !== after.inUse?.id && r.id !== id)
    const last: FartChoices = {
      ...choices,
      excluded: [...choices.excluded, ...others.map(r => r.id)].sort()
    }
    const alone = fartSheet(song, recordings, last, pitch)
    expect(alone.inUse).not.toBeNull()
    expect(alone.isOnlyFart).toBe(true)
    const locked = changedChoices(
      { kind: 'leaveOut', songPitch: pitch, id: alone.inUse?.id as string },
      song,
      recordings,
      last
    )
    expect(choiceForSongPitch(arrangeChoices(song, recordings, locked), pitch)?.recordingId).toBe(
      null
    )
    expect(fartSheet(song, recordings, locked, pitch).inUse).toBeNull()
  })

  it('says how long a fart must last and how many notes the pitch has', () => {
    const sheet = fartSheet(song, recordings, null, song.pitches[0])
    expect(sheet.noteCount).toBe(song.durations[0].length)
    expect(sheet.neededSeconds).toBeGreaterThan(0)
    expect(Math.round(sheet.neededSeconds * 10)).toBeCloseTo(sheet.neededSeconds * 10, 6)
  })
})

describe('a fart’s distance from the note', () => {
  it('reads in semitones within the octave, and from the octave past it', () => {
    expect(noteDistance(0)).toBe('on the note')
    expect(noteDistance(1)).toBe('1 semitone low')
    expect(noteDistance(-2)).toBe('2 semitones high')
    expect(noteDistance(12)).toBe('an octave low')
    expect(noteDistance(-12)).toBe('an octave high')
    expect(noteDistance(13)).toBe('an octave and 1 low')
    expect(noteDistance(-15)).toBe('an octave and 3 high')
    expect(noteDistance(-11)).toBe('11 semitones high')
  })
})

describe('a change to a Song’s farts', () => {
  const pitch = song.pitches[0]
  const sheet = fartSheet(song, recordings, null, pitch)
  const swapIn = (sheet.free[0] ?? sheet.others[0]).id

  it('starts from the automatic transposition and is automatic again once undone', () => {
    const swap = { kind: 'swap', songPitch: pitch, id: swapIn } as const
    const swapped = changedChoices(swap, song, recordings, null)
    expect(swapped).toEqual(swapFart(noChoices(auto.transposition), pitch, swapIn))
    expect(
      changedChoices({ kind: 'reset', songPitch: pitch }, song, recordings, swapped)
    ).toBeNull()
    expect(changedChoices({ kind: 'resetAll' }, song, recordings, swapped)).toBeNull()
    const leftOut = changedChoices(
      { kind: 'leaveOut', songPitch: pitch, id: swapIn },
      song,
      recordings,
      null
    )
    expect(changedChoices({ kind: 'useAgain', id: swapIn }, song, recordings, leftOut)).toBeNull()
  })

  it('says what moved, its own pitch first', () => {
    const swap = { kind: 'swap', songPitch: pitch, id: swapIn } as const
    const after = arrangeChoices(song, recordings, changedChoices(swap, song, recordings, null))
    const line = changeLine(swap, auto, after, name)
    expect(
      line.startsWith(`${noteName(pitch + auto.transposition)} now uses ${name(swapIn)}.`)
    ).toBe(true)
    // A fart taken from another pitch moves that pitch too, and the line says so.
    const taken = sheet.others.find(r => r.id === swapIn)
    if (taken) expect(line).toContain(`${noteName(taken.playsNote as number)} now uses`)
  })

  it('names a left-out fart, a reset pitch and a fart brought back', () => {
    const id = sheet.inUse?.id as string
    const leaveOut = { kind: 'leaveOut', songPitch: pitch, id } as const
    const leftOut = changedChoices(leaveOut, song, recordings, null)
    const after = arrangeChoices(song, recordings, leftOut)
    expect(changeLine(leaveOut, auto, after, name)).toMatch(
      new RegExp(
        `^${name(id)} is left out of this Song\\. ${noteName(pitch + auto.transposition)} (now uses Recording \\d+|has no fart)\\.`
      )
    )
    const useAgain = { kind: 'useAgain', id } as const
    expect(changeLine(useAgain, after, auto, name)).toMatch(
      new RegExp(`^${name(id)} can play in this Song again\\.`)
    )
    const reset = { kind: 'reset', songPitch: pitch } as const
    expect(changeLine(reset, after, auto, name)).toMatch(
      new RegExp(`^${noteName(pitch + auto.transposition)} is back to Farty's pick\\.`)
    )
    expect(changeLine({ kind: 'resetAll' }, after, auto, name)).toBe(
      "Every note is back to Farty's pick."
    )
  })

  it('says a pitch left with no fart has none', () => {
    const id = sheet.inUse?.id as string
    const everyFart: FartChoices = {
      transposition: auto.transposition,
      preferred: {},
      excluded: rowsOf(sheet)
        .map(r => r.id)
        .filter(r => r !== id)
        .sort()
    }
    const leaveOut = { kind: 'leaveOut', songPitch: pitch, id } as const
    const before = arrangeChoices(song, recordings, everyFart)
    const after = arrangeChoices(
      song,
      recordings,
      changedChoices(leaveOut, song, recordings, everyFart)
    )
    expect(changeLine(leaveOut, before, after, name)).toContain(
      `${noteName(pitch + auto.transposition)} has no fart.`
    )
  })
})
