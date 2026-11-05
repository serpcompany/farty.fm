import { describe, expect, it } from 'vitest'
import type { Song, SongNote } from '@/lib/catalog/song'
import { Layout } from './note-view'

function songOf(notes: SongNote[], lengthBeats: number): Song {
  const pitches = [...new Set(notes.map(note => note.pitch))].sort((a, b) => a - b)
  return { notes, pitches, length_beats: lengthBeats, bpm: 100 } as unknown as Song
}

const notes: SongNote[] = [
  { start: 0, dur: 0.5, pitch: 60 },
  { start: 0.5, dur: 0.5, pitch: 62 },
  { start: 1, dur: 1, pitch: 64 },
  { start: 2, dur: 1, pitch: 60 },
  // a rest of half a beat, then a long note, a rest, and two eighths
  { start: 3.5, dur: 1.5, pitch: 65 },
  { start: 5.25, dur: 0.25, pitch: 67 },
  { start: 5.5, dur: 0.25, pitch: 65 }
]

describe('Layout.rect', () => {
  for (const width of [390 - 24, 200, 1000]) {
    const layout = new Layout(songOf(notes, 6), width, 156)
    const rects = notes.map(note => layout.rect(note))

    it(`leaves no gap between notes that touch, at ${width} px`, () => {
      for (let i = 0; i < notes.length - 1; i++) {
        if (notes[i].start + notes[i].dur !== notes[i + 1].start) continue
        const r = rects[i]
        const wanted = rects[i + 1].x
        // Short notes are widened up to the note height, never past the next start.
        if (r.width >= r.height) expect(r.x + r.width).toBeCloseTo(wanted, 6)
        else expect(r.x + r.width).toBeLessThanOrEqual(wanted + 1e-6)
      }
    })

    it(`never draws a note past the next note's start, at ${width} px`, () => {
      for (let i = 0; i < notes.length - 1; i++) {
        expect(rects[i].x + rects[i].width).toBeLessThanOrEqual(rects[i + 1].x + 1e-6)
      }
    })

    it(`keeps a note after a rest apart from the next, at ${width} px`, () => {
      expect(rects[3].x + rects[3].width).toBeLessThan(rects[4].x)
    })
  }

  it('keeps a short note at least as wide as it is tall when room allows', () => {
    const layout = new Layout(songOf(notes, 6), 366, 156)
    const r = layout.rect(notes[5])
    expect(r.width).toBeGreaterThanOrEqual(Math.min(r.height, layout.x(0.25)))
  })
})
