export const pitchClassNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']

export function nearestNote(midi: number): number {
  return Math.floor(midi + 0.5)
}

export function pitchClass(midi: number): number {
  return ((nearestNote(midi) % 12) + 12) % 12
}

export function noteName(midi: number): string {
  const note = nearestNote(midi)
  const octave = Math.floor(note / 12) - 1
  return pitchClassNames[pitchClass(note)] + String(octave)
}
