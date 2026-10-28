export type Song = {
  id: string
  title: string
  source: string
  bpm: number
  bar_lines: readonly number[]
  length_beats: number
  pitches: readonly number[]
  notes: readonly SongNote[]
}

export type SongNote = {
  start: number
  dur: number
  pitch: number
}
