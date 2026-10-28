import type { Song, SongNote } from '@/lib/catalog/song'
import { noteName } from '@/lib/pitch'
import { formattedLength, type Recording, recordingName, recordingPitch } from '@/lib/recordings'

export type TootArrangement = {
  transposition: number
  recordingForPitch: Record<number, string>
}

export type TootDraft = {
  id: string
  song: Song
  arrangement: TootArrangement
  seconds: number
  wav: ArrayBuffer
}

export type Toot = {
  id: string
  title: string
  songId: string
  createdAt: number
  seconds: number
  arrangement: TootArrangement
  isAudioMissing?: boolean
}

export function formattedTootLength(seconds: number): string {
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

const msPerDay = 86_400_000

function calendarDaysBetween(from: Date, to: Date): number {
  const midnight = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())
  return Math.round((midnight(to).getTime() - midnight(from).getTime()) / msPerDay)
}

export function formattedTootDate(createdAt: number, now: Date = new Date()): string {
  const made = new Date(createdAt)
  const daysAgo = calendarDaysBetween(made, now)
  if (daysAgo === 0) return 'Today'
  if (daysAgo === 1) return 'Yesterday'
  return made.toLocaleDateString(undefined, { dateStyle: 'medium' })
}

export function tootDetails(toot: Toot, songTitle: string, now: Date = new Date()): string {
  const rest = toot.isAudioMissing
    ? ['Audio missing']
    : [formattedTootDate(toot.createdAt, now), formattedTootLength(toot.seconds)]
  return [songTitle, ...rest].join(' · ')
}

export function soundingPitch(arrangement: TootArrangement, pitch: number): number {
  return pitch + arrangement.transposition
}

export function noteSeconds(
  song: Pick<Song, 'bpm'>,
  note: SongNote
): { start: number; length: number } {
  const beat = 60 / song.bpm
  return { start: note.start * beat, length: note.dur * beat }
}

export function noteCaption(
  song: Song,
  arrangement: TootArrangement,
  note: SongNote,
  recording: Recording | undefined
): string {
  const name = noteName(soundingPitch(arrangement, note.pitch))
  const length = formattedLength(noteSeconds(song, note).length)
  if (!recording) return `${name} · Recording deleted · ${length}`
  const pitch = recordingPitch(recording)
  if (pitch === null) return `${name} · ${recordingName(recording)} · ${length}`
  return `${name} · ${recordingName(recording)} (${noteName(pitch)}) · ${length}`
}
