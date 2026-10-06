import { describe, expect, it } from 'vitest'
import { noteName, pitchClass } from './pitch'

describe('noteName', () => {
  it('names the nearest note with its octave, MIDI 60 being C4', () => {
    expect(noteName(60)).toBe('C4')
    expect(noteName(55.83)).toBe('G♯3')
    expect(noteName(45.0259)).toBe('A2')
  })

  it('rounds half up, like the iPhone app', () => {
    expect(noteName(59.5)).toBe('C4')
    expect(noteName(59.49)).toBe('B3')
  })

  it('handles octaves below C0', () => {
    expect(noteName(11)).toBe('B-1')
    expect(pitchClass(-1)).toBe(11)
  })
})
