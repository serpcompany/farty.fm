export type Song = {
  id: string
  title: string
  source: string
  bpm: number
  beats_per_bar: number
  length_beats: number
  pitches: readonly number[]
  notes: readonly SongNote[]
}

export type SongNote = {
  start: number
  dur: number
  pitch: number
}
