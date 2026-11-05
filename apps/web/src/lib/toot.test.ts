import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Song, SongNotes } from './catalog/song'
import { songIndex } from './catalog/song-index.generated'
import { songs } from './catalog/songs.generated'
import type { Recording } from './recordings'
import {
  formattedTootDate,
  formattedTootLength,
  noteCaption,
  noteSeconds,
  type PadToot,
  parseTootScore,
  type SongToot,
  type SongTootDraft,
  savedToot,
  songAsMade,
  type Toot,
  type TootArrangement,
  tootDetails,
  tootScore
} from './toot'

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

  it('names the note, its Recording and Recording Pitch, and the written length', () => {
    // The fart plays raw, at its own pitch (ADR 0012), so the caption names no shift.
    const sounding = note.pitch - 2
    const length = noteSeconds(song, note).length.toFixed(1)
    const caption = noteCaption(song, arrangement, note, recording(sounding + 2.1))
    expect(caption).toMatch(
      new RegExp(`^[A-G]♯?\\d · Recording 21 \\([A-G]♯?\\d\\) · ${length} s$`)
    )
  })

  it('says the Recording was deleted', () => {
    expect(noteCaption(song, arrangement, note, undefined)).toMatch(/ · Recording deleted · /)
  })

  it('says no fart plays a note its Song has none for (#360)', () => {
    const gap: TootArrangement = { transposition: -2, recordingForPitch: {} }
    expect(noteCaption(song, gap, note, undefined)).toMatch(/^[A-G]♯?\d · No fart · \d+\.\d s$/)
  })

  it('leaves out the Recording Pitch of a Recording without one', () => {
    expect(noteCaption(song, arrangement, note, recording(null))).toMatch(
      /^[A-G]♯?\d · Recording 21 · \d+\.\d s$/
    )
  })

  it('names the note a Noise-like Recording is placed on by ear (ADR 0015)', () => {
    expect(noteCaption(song, arrangement, note, { ...recording(null), placedPitch: 36 })).toMatch(
      /^[A-G]♯?\d · Recording 21 \(C2\) · \d+\.\d s$/
    )
  })

  it('times a note by its written start and length', () => {
    expect(noteSeconds({ bpm: 120 }, { start: 3, dur: 1.5, pitch: 60 })).toEqual({
      start: 1.5,
      length: 0.75
    })
  })
})

describe('a Toot row', () => {
  const now = new Date(2026, 9, 21, 9, 30)
  const toot: Toot = {
    id: 't',
    title: 'Mine',
    songId: 'mary',
    createdAt: new Date(2026, 9, 21, 0, 5).getTime(),
    seconds: 12.4,
    arrangement: { transposition: 0, recordingForPitch: {} }
  }

  it('gives the length in minutes and seconds, rounded to the second', () => {
    expect(formattedTootLength(12.4)).toBe('0:12')
    expect(formattedTootLength(16.5)).toBe('0:17')
    expect(formattedTootLength(59.6)).toBe('1:00')
    expect(formattedTootLength(75)).toBe('1:15')
  })

  it('says Today and Yesterday by the calendar day, and a date before that', () => {
    expect(formattedTootDate(new Date(2026, 9, 21, 0, 0).getTime(), now)).toBe('Today')
    expect(formattedTootDate(new Date(2026, 9, 20, 23, 59).getTime(), now)).toBe('Yesterday')
    expect(formattedTootDate(new Date(2026, 9, 20, 0, 0).getTime(), now)).toBe('Yesterday')
    const older = formattedTootDate(new Date(2026, 9, 19, 12).getTime(), now)
    expect(older).not.toMatch(/Today|Yesterday/)
    expect(older).toContain('2026')
  })

  it('shows the Song, the date and the length, or that the audio is missing', () => {
    expect(tootDetails(toot, 'Mary Had a Little Lamb', now)).toBe(
      'Mary Had a Little Lamb · Today · 0:12'
    )
    expect(tootDetails({ ...toot, isAudioMissing: true }, 'Mary Had a Little Lamb', now)).toBe(
      'Mary Had a Little Lamb · Audio missing'
    )
  })
})

describe("a saved Toot's score, across two versions of the catalog (#254)", () => {
  /** A Song as the catalog has it when the Toot is made. */
  const before = songs.find(s => s.id === 'mary') ?? songs[0]
  const draft: SongTootDraft = {
    id: 't',
    song: before,
    arrangement: { transposition: 0, recordingForPitch: {} },
    seconds: 12,
    wav: new ArrayBuffer(0)
  }
  const toot = savedToot(draft, 1000) as SongToot

  /** Only the Song's end moves, as PR 410 moved 395 Songs': the notes before it stay put. */
  function endingAfter(count: number): Song {
    const notes = before.notes.slice(0, count)
    const last = notes[notes.length - 1]
    const length = last.start + last.dur
    return {
      ...before,
      notes,
      length_beats: length,
      lengthBeats: length,
      bar_lines: before.bar_lines.filter(bar => bar < length),
      notesPath: 'notes/shortened.json'
    }
  }
  const shortened = endingAfter(before.notes.length - 3)
  /** A re-import, as #232's: another score, at another tempo, with other notes and bars. */
  const reimported: Song = {
    ...before,
    bpm: before.bpm * 2,
    notes: before.notes.map(note => ({ ...note, start: note.start + 1, pitch: note.pitch + 12 })),
    pitches: before.pitches.map(pitch => pitch + 12),
    bar_lines: before.bar_lines.map(bar => bar + 1),
    length_beats: before.length_beats + 1,
    lengthBeats: before.lengthBeats + 1,
    notesPath: 'notes/reimported.json'
  }

  it('keeps the tempo, bar lines and notes it was rendered from, and nothing else of the Song', () => {
    expect(toot).toEqual({
      id: 't',
      title: before.title,
      createdAt: 1000,
      seconds: 12,
      songId: before.id,
      arrangement: draft.arrangement,
      score: {
        bpm: before.bpm,
        bar_lines: before.bar_lines,
        length_beats: before.length_beats,
        notes: before.notes
      }
    })
  })

  it.each([
    ['moved its end', shortened],
    ['re-imported it', reimported]
  ])('draws the notes it was rendered with after the catalog %s', (_, after) => {
    const song = songAsMade(toot, after)
    expect(song?.notes).toEqual(before.notes)
    expect(song?.bar_lines).toEqual(before.bar_lines)
    expect(song?.length_beats).toBe(before.length_beats)
    expect(song?.lengthBeats).toBe(before.length_beats)
    expect(song?.bpm).toBe(before.bpm)
    // The piano roll's range and colours, and the Recordings it lists, read these.
    expect(song?.pitches).toEqual(before.pitches)
    expect(song?.durations).toEqual(before.durations)
    // Who the Song is stays the catalog's.
    expect(song?.title).toBe(after.title)
  })

  it.each([
    ['moved its end', shortened],
    ['re-imported it', reimported]
  ])('slices each note where it was rendered after the catalog %s', (_, after) => {
    const score = tootScore(toot, after)
    if (!score) throw new Error('No score')
    before.notes.forEach((note, index) => {
      expect(noteSeconds(score, score.notes[index])).toEqual(noteSeconds(before, note))
    })
  })

  it("draws and slices a Toot saved before #254 from its Song's notes today, as it always has", () => {
    const { score: _, ...old } = toot
    expect(songAsMade(old, reimported)).toBeNull()
    expect(tootScore(old, reimported)).toBe(reimported)
    // Not by another Song's notes, or before the Song's have loaded.
    expect(tootScore(old, { ...reimported, id: 'other' })).toBeUndefined()
    expect(tootScore(old, null)).toBeUndefined()
  })

  // A score the Worker refuses is a Toot that never reaches the account.
  it("takes the score of every Song in the catalog, whose notes it's rendered from", () => {
    const folder = join(process.cwd(), 'public/catalog/notes')
    const files = readdirSync(folder)
    expect(files.length).toBeGreaterThan(900)
    for (const file of files) {
      const notes = JSON.parse(readFileSync(join(folder, file), 'utf8')) as SongNotes
      const bpm = songIndex.find(song => song.notesPath.endsWith(file))?.bpm
      const score = { bpm, ...notes }
      expect(parseTootScore(score), file).toEqual(score)
    }
  })

  it('keeps no score for a Sound Pad Toot, which has no Song', () => {
    const performance = { recordings: ['a'], taps: [[0, 0]] } as PadToot['performance']
    const pad = savedToot(
      { id: 'p', song: null, performance, seconds: 1, wav: new ArrayBuffer(0) },
      1000
    )
    expect(pad).toEqual({
      id: 'p',
      title: 'Sound Pad',
      createdAt: 1000,
      seconds: 1,
      songId: null,
      arrangement: null,
      performance
    })
    expect(songAsMade(pad, before)).toBeNull()
    expect(tootScore(pad, before)).toBeUndefined()
  })
})
