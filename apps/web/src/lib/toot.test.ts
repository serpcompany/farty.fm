import { describe, expect, it } from 'vitest'
import { songs } from './catalog/songs.generated'
import type { Recording } from './recordings'
import { noteCaption, noteSeconds, semitones, type TootArrangement } from './toot'

describe('semitones', () => {
  it('rounds to a tenth, with a sign, as the iPhone app', () => {
    expect(semitones(1.24)).toBe('+1.2 semitones')
    expect(semitones(-2.75)).toBe('−2.8 semitones')
    expect(semitones(0.04)).toBe('0.0 semitones')
    expect(semitones(-0.04)).toBe('0.0 semitones')
  })
})

describe('noteCaption', () => {
  const song = songs.find(s => s.id === 'mary') ?? songs[0]
  const note = song.notes[0]
  const arrangement: TootArrangement = {
    transposition: -2,
    recordingForPitch: { [note.pitch]: 'a' }
  }
  const recording = (recordingPitchMidi: number | null): Recording => ({
    id: 'a',
    number: 21,
    createdAt: 0,
    seconds: 1,
    sampleRate: 48000,
    waveform: [],
    analysis: {
      state: 'analyzed',
      analysis: {
        gestureStartSeconds: 0,
        gestureEndSeconds: 1,
        cutAtReattack: false,
        pitchEstimateMidi: recordingPitchMidi,
        pitchConfidence: 1,
        recordingPitchMidi,
        shortestNoteSeconds: recordingPitchMidi === null ? null : 0.5
      }
    }
  })

  it('names the note, its Recording and Recording Pitch, the shift and the written length', () => {
    const sounding = note.pitch - 2
    const length = noteSeconds(song, note).length.toFixed(1)
    const caption = noteCaption(song, arrangement, note, recording(sounding + 2.1))
    expect(caption).toMatch(
      new RegExp(
        `^[A-G]♯?\\d · Recording 21 \\([A-G]♯?\\d\\), shifted −2\\.1 semitones · ${length} s$`
      )
    )
  })

  it('says the Recording was deleted', () => {
    expect(noteCaption(song, arrangement, note, undefined)).toMatch(/ · Recording deleted · /)
  })

  it('leaves out the shift of a Recording without a pitch', () => {
    expect(noteCaption(song, arrangement, note, recording(null))).toMatch(
      /^[A-G]♯?\d · Recording 21 · \d+\.\d s$/
    )
  })

  it('times a note by its written start and length', () => {
    expect(noteSeconds({ bpm: 120 }, { start: 3, dur: 1.5, pitch: 60 })).toEqual({
      start: 1.5,
      length: 0.75
    })
  })
})
