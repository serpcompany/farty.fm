import type { Analysis } from '@/lib/recordings'
import type { PcmAudio } from '@/lib/wav'
import { type Arrangement, choiceForSongPitch } from './auto-map'
import { renderSource } from './render-source'
import { noteInBeats, RENDER_SAMPLE_RATE, type RenderSource, render, songSeconds } from './renderer'
import type { Song } from './song'

interface RenderedNote {
  noteIndex: number
  recordingId: string
  targetMidi: number
  startSample: number
  lengthSamples: number
  gainDb: number
}

export interface RenderedSong {
  samples: Float32Array
  sampleRate: number
  notes: RenderedNote[]
}

export function renderSong(
  song: Song,
  arrangement: Arrangement,
  sources: ReadonlyMap<string, RenderSource>
): RenderedSong {
  if (!arrangement.unlocked) {
    throw new Error(`Song is locked: ${arrangement.covered} of ${arrangement.total} notes covered`)
  }
  const ids: string[] = []
  const notes = song.notes.map(note => {
    const id = choiceForSongPitch(arrangement, note.pitch)?.recordingId
    const source = id == null ? undefined : sources.get(id)
    if (id == null || source === undefined) {
      throw new Error(`No Recording plays pitch ${note.pitch}`)
    }
    ids.push(id)
    return noteInBeats(source, note.pitch + arrangement.transposition, {
      start: note.start,
      dur: note.dur,
      bpm: song.bpm,
      barLines: song.bar_lines
    })
  })
  const output = render(notes, songSeconds(song.length_beats, song.bpm))
  return {
    samples: output.samples,
    sampleRate: RENDER_SAMPLE_RATE,
    notes: output.notes.map((placed, i) => ({
      noteIndex: i,
      recordingId: ids[i],
      targetMidi: notes[i].targetMidi,
      ...placed
    }))
  }
}

export interface RecordingToRender {
  id: string
  audio: PcmAudio
  analysis: Analysis
}

export function renderFromRecordings(
  song: Song,
  arrangement: Arrangement,
  recordings: readonly RecordingToRender[]
): RenderedSong {
  const used = new Set(arrangement.pitches.map(c => c.recordingId))
  const sources = new Map<string, RenderSource>()
  for (const r of recordings) {
    if (used.has(r.id)) sources.set(r.id, renderSource(r.audio, r.analysis))
  }
  return renderSong(song, arrangement, sources)
}
