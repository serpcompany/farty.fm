export type SongSummary = {
  id: string
  title: string
  aliases?: readonly string[]
  source: string
  bpm: number
  pitches: readonly number[]
  durations: readonly (readonly number[])[]
  notesPath: string
}

export type SongNotes = {
  bar_lines: readonly number[]
  length_beats: number
  notes: readonly SongNote[]
}

export type Song = SongSummary & SongNotes

export type SongNote = {
  start: number
  dur: number
  pitch: number
}
