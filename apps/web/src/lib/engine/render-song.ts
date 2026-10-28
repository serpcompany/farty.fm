import type { Analysis } from '@/lib/recordings'
import type { PcmAudio } from '@/lib/wav'
import { type Arrangement, choiceForSongPitch } from './auto-map'
import { songBeats } from './beats'
import { renderSource } from './render-source'
import {
  beatInBeats,
  noteInBeats,
  RENDER_SAMPLE_RATE,
  type RenderSource,
  render,
  songSeconds
} from './renderer'
import type { Song } from './song'

/** Where one of the Song's notes landed in the audio, and which Recording played it. */
export interface RenderedNote {
  /** The note's index in the Song. */
  noteIndex: number
  recordingId: string
  /** The note it plays, as a MIDI note number (the Song's pitch plus the transposition). */
  targetMidi: number
  startSample: number
  lengthSamples: number
  gainDb: number
}

/** Where one of the Song's Beats landed in the audio (ADR 0014), and which Recording played it. */
export interface RenderedBeat {
  /** The bar it starts: its index in the Song's `bar_lines`. */
  bar: number
  recordingId: string
  startSample: number
  lengthSamples: number
  gainDb: number
}

/** A Song played by Recordings, as audio. */
export interface RenderedSong {
  /** Mono, peak at about −1 dBFS: the Song plus a second for the last note to ring. */
  samples: Float32Array
  sampleRate: number
  /** The Song's notes, in order. */
  notes: RenderedNote[]
  /** Its Beats, bar by bar: none without Noise-like Recordings. */
  beats: RenderedBeat[]
}

/**
 * Plays `song` with its Arrangement: every note of a Song pitch on that pitch's Recording (the
 * reference's `plan()`), and a Beat on each bar line with `beatRecordings` taking turns
 * (`songBeats`, the reference's `plan_beats()`), then the renderer. `sources` holds at least every
 * Recording the Arrangement and the Beats use, by id. Throws if the Song is locked or a source is
 * missing.
 *
 * Synchronous and CPU-bound: run it in a Web Worker.
 */
export function renderSong(
  song: Song,
  arrangement: Arrangement,
  sources: ReadonlyMap<string, RenderSource>,
  beatRecordings: readonly string[] = []
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
  const beats = songBeats(song, beatRecordings)
  const renderBeats = beats.map(beat => {
    const source = sources.get(beat.recordingId)
    if (source === undefined) throw new Error(`No Recording ${beat.recordingId} for the Beats`)
    return beatInBeats(source, { start: beat.start, dur: beat.dur, bpm: song.bpm })
  })
  const output = render(notes, songSeconds(song.length_beats, song.bpm), renderBeats)
  return {
    samples: output.samples,
    sampleRate: RENDER_SAMPLE_RATE,
    notes: output.notes.map((placed, i) => ({
      noteIndex: i,
      recordingId: ids[i],
      targetMidi: notes[i].targetMidi,
      ...placed
    })),
    beats: output.beats.map((placed, i) => ({
      bar: beats[i].bar,
      recordingId: beats[i].recordingId,
      ...placed
    }))
  }
}

/** A Recording as the app keeps it: its audio and its stored analysis. */
export interface RecordingToRender {
  id: string
  /** The whole Recording at its own sample rate, as Recording Analysis read it. */
  audio: PcmAudio
  analysis: Analysis
}

/**
 * The whole render from what the app stores: cuts each Recording the Arrangement and the Beats
 * use to its gesture, and renders. `beatRecordings` are the Noise-like Recordings that play the
 * Beats, in turn (`beatRecordings` in `beats.ts`). This is what the render worker runs.
 */
export function renderFromRecordings(
  song: Song,
  arrangement: Arrangement,
  recordings: readonly RecordingToRender[],
  beatRecordings: readonly string[] = []
): RenderedSong {
  const used = new Set<string | null>([
    ...arrangement.pitches.map(c => c.recordingId),
    ...beatRecordings
  ])
  const sources = new Map<string, RenderSource>()
  for (const r of recordings) {
    if (used.has(r.id)) sources.set(r.id, renderSource(r.audio, r.analysis))
  }
  return renderSong(song, arrangement, sources, beatRecordings)
}
