/** Note names for MIDI note numbers, the way the app shows a Recording Pitch ("G♯3"). */

/** The twelve pitch classes from C. */
export const pitchClassNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']

/** The nearest note as a MIDI note number, rounding half up like the iPhone app: 55.83 → 56. */
export function nearestNote(midi: number): number {
  return Math.floor(midi + 0.5)
}

/** The nearest note's pitch class, 0 (C) to 11 (B). */
export function pitchClass(midi: number): number {
  return ((nearestNote(midi) % 12) + 12) % 12
}

/** The nearest note's name with its octave, where MIDI 60 is C4: 55.83 → "G♯3". */
export function noteName(midi: number): string {
  const note = nearestNote(midi)
  const octave = Math.floor(note / 12) - 1
  return pitchClassNames[pitchClass(note)] + String(octave)
}
