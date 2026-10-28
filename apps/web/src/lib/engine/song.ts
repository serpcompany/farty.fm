export interface Song {
  bpm: number
  bar_lines: readonly number[]
  length_beats: number
  notes: SongNote[]
}

interface SongNote {
  start: number
  dur: number
  pitch: number
}

export function secondsPerBeat(song: Pick<Song, 'bpm'>): number {
  return 60 / song.bpm
}
