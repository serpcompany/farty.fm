import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { songs } from '@/lib/catalog/songs.generated'
import { GAP_SECONDS } from '@/lib/engine/renderer'
import { noteSeconds } from '@/lib/toot'
import { pianoNote, playPianoNote } from './piano-keys'
import { pianoPosition, pianoSchedule, playPiano, stopPiano } from './piano-preview'

/** The fake context's clock, in seconds: the test moves it. */
let clock = 0

type Call = [method: string, value: number, time: number | undefined]
type FakeParam = { value: number; calls: Call[] }
type FakeBuffer = { duration: number; sampleRate: number; data: Float32Array }
type FakeSource = { buffer: FakeBuffer | null; output?: unknown; started?: number; stops: number[] }

/** The fake contexts' sample rate: low, so building a note is quick. */
const RATE = 8000
/** Every note started, in order. */
const sources: FakeSource[] = []
/** Each gain made, with what was scheduled on it. */
const gains: FakeParam[] = []
/** What `whenClosing` was given: run before a context closes. */
const closing = vi.hoisted(() => [] as ((context: unknown) => void)[])

function param(value: number): FakeParam {
  const p: FakeParam = { value, calls: [] }
  const record = (method: string) => (v: number, t?: number) => {
    p.calls.push([method, v, t])
  }
  return Object.assign(p, {
    setValueAtTime: record('setValueAtTime'),
    exponentialRampToValueAtTime: record('exponentialRampToValueAtTime'),
    linearRampToValueAtTime: record('linearRampToValueAtTime'),
    cancelScheduledValues: record('cancelScheduledValues')
  })
}

const node = <T extends object>(fields: T) => ({
  ...fields,
  connect: (next: unknown) => next,
  disconnect: () => {}
})

/** A fake AudioContext, with every buffer it built. */
function fakeContext() {
  const buffers: FakeBuffer[] = []
  return {
    buffers,
    get currentTime() {
      return clock
    },
    sampleRate: RATE,
    outputLatency: 0,
    state: 'running',
    destination: {},
    resume: async () => {},
    createGain: () => {
      const gain = param(1)
      gains.push(gain)
      return node({ gain })
    },
    createBuffer: (_channels: number, length: number, sampleRate: number) => {
      const data = new Float32Array(length)
      const buffer = { duration: length / sampleRate, sampleRate, data, getChannelData: () => data }
      buffers.push(buffer)
      return buffer
    },
    createBufferSource: () => {
      const source: FakeSource = { buffer: null, stops: [] }
      sources.push(source)
      return {
        set buffer(buffer: FakeBuffer) {
          source.buffer = buffer
        },
        get buffer() {
          return source.buffer as FakeBuffer
        },
        connect: (output: unknown) => {
          source.output = output
          return output
        },
        start: (t: number) => {
          source.started = t
        },
        stop: (t: number) => {
          source.stops.push(t)
        }
      }
    }
  }
}

let context = fakeContext()

vi.mock('@/lib/audio/context', () => ({
  setPlaybackSession: () => {},
  whenClosing: (stop: (context: unknown) => void) => closing.push(stop),
  isClosed: () => false,
  audioContext: () => context
}))

/** `pianoNote` at RATE, by MIDI note, built as the tests ask. */
const notesAtRate = new Map<number, Float32Array>()
/** The MIDI note whose `pianoNote` `buffer` holds. */
function midiOf(buffer: FakeBuffer | null): number {
  for (let midi = 0; midi < 128; midi++) {
    let samples = notesAtRate.get(midi)
    if (!samples) {
      samples = pianoNote(midi, RATE)
      notesAtRate.set(midi, samples)
    }
    if (
      buffer &&
      samples.length === buffer.data.length &&
      samples.every((v, i) => v === buffer.data[i])
    )
      return midi
  }
  return Number.NaN
}

/** The notes struck, in order: when each starts, and which note its buffer is. */
function struck(): { at: number; midi: number }[] {
  return sources.map(s => ({ at: s.started ?? Number.NaN, midi: midiOf(s.buffer) }))
}

/** When each note struck is let go, by the damper on it: [held until, silent at]. */
function letGo(): [number, number][] {
  return gains
    .filter(g => g.calls[0]?.[0] === 'setValueAtTime' && g.calls[0][1] === 1)
    .map(g => [g.calls[0][2] ?? Number.NaN, g.calls[1][2] ?? Number.NaN])
}

const settle = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(performance, 'now').mockReturnValue(10_000)
  clock = 5
  context = fakeContext()
  sources.length = 0
  gains.length = 0
})

afterEach(() => {
  stopPiano()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('pianoSchedule', () => {
  test('plays every note of a Song in the Toot’s key, at its tempo, held as the renderer holds it', () => {
    const song = songs.find(s => s.id === 'mary')
    if (!song) throw new Error('Mary Had a Little Lamb is in the catalog')
    const schedule = pianoSchedule(song, -24)
    expect(schedule).toHaveLength(song.notes.length)
    song.notes.forEach((note, i) => {
      const written = noteSeconds(song, note)
      expect(schedule[i].midi).toBe(note.pitch - 24)
      expect(schedule[i].start).toBeCloseTo(written.start, 9)
      expect(schedule[i].seconds).toBeCloseTo(Math.max(0.06, written.length - GAP_SECONDS), 9)
    })
  })

  test('at 120 bpm a beat is half a second', () => {
    const song = {
      bpm: 120,
      notes: [
        { start: 1, dur: 0.5, pitch: 62 },
        { start: 0, dur: 1, pitch: 60 },
        { start: 1.5, dur: 0.05, pitch: 64 }
      ]
    }
    expect(pianoSchedule(song, 3)).toEqual([
      { midi: 65, start: 0.5, seconds: 0.225 },
      { midi: 63, start: 0, seconds: 0.475 },
      // Never shorter than the renderer's shortest note.
      { midi: 67, start: 0.75, seconds: 0.06 }
    ])
  })
})

describe('playPianoNote', () => {
  test('a key on the review plays its whole note, straight to the speakers', () => {
    playPianoNote(57)
    expect(struck()).toEqual([{ at: 5, midi: 57 }])
    expect(sources[0].output).toBe(context.destination)
    expect(sources[0].buffer?.duration).toBeCloseTo(2.3, 9)
    expect(sources[0].stops).toEqual([])
    expect(letGo()).toEqual([])
  })

  test('each note is built once per context, and again on the context that replaces it', () => {
    playPianoNote(57)
    playPianoNote(57)
    playPianoNote(45)
    expect(context.buffers).toHaveLength(2)
    expect(sources[1].buffer).toBe(sources[0].buffer)
    // A context replaced after the page hid starts with none built.
    const first = context
    context = fakeContext()
    playPianoNote(57)
    expect(context.buffers).toHaveLength(1)
    expect(sources[3].buffer).not.toBe(sources[0].buffer)
    expect(first.buffers).toHaveLength(2)
  })

  test('keeps the 16 notes used last', () => {
    for (let midi = 40; midi < 57; midi++) playPianoNote(midi)
    expect(context.buffers).toHaveLength(17)
    // 41 to 56 are kept, and 40, the one used longest ago, is built again.
    playPianoNote(56)
    playPianoNote(41)
    expect(context.buffers).toHaveLength(17)
    playPianoNote(40)
    expect(context.buffers).toHaveLength(18)
  })
})

describe('playPiano', () => {
  const notes = Array.from({ length: 10 }, (_, i) => ({
    midi: 48 + i,
    start: i * 0.5,
    seconds: 0.4
  }))

  test('schedules the notes a little ahead, each at its start after a short lead', async () => {
    const started = vi.fn()
    playPiano(notes, { onStarted: started })
    await settle()
    // The first note plays 0.06 s after the tap, and notes up to 1.5 s ahead are scheduled.
    expect(started).toHaveBeenCalledWith(10_000 + 60)
    expect(struck().map(n => n.midi)).toEqual([48, 49, 50])
    clock = 6
    await vi.advanceTimersByTimeAsync(200)
    expect(struck()).toHaveLength(5)
    clock = 10
    await vi.advanceTimersByTimeAsync(200)
    expect(struck().map(n => n.midi)).toEqual(notes.map(n => n.midi))
    struck().forEach((n, i) => {
      expect(n.at).toBeCloseTo(5.06 + notes[i].start, 9)
    })
    // Each held for its length, then let go over 0.08 s, and stopped.
    letGo().forEach(([held, silent], i) => {
      expect(held).toBeCloseTo(5.06 + notes[i].start + 0.4, 9)
      expect(silent).toBeCloseTo(held + 0.08, 9)
    })
    sources.forEach((s, i) => {
      expect(s.stops.at(-1)).toBeCloseTo(letGo()[i][1] + 0.02, 9)
    })
  })

  test('from a point in the notes: the one sounding there plays what’s left of it', async () => {
    const started = vi.fn()
    playPiano(notes, { from: 1.2, onStarted: started })
    await settle()
    // Notes 0 and 1 are over; note 2 (1.0 to 1.4 s) has 0.2 s left.
    expect(struck()[0]).toEqual({ at: 5.06, midi: 50 })
    expect(letGo()[0][0]).toBeCloseTo(5.06 + 0.2, 9)
    expect(struck()[1].at).toBeCloseTo(5.06 + 0.3, 9)
    // The playhead's 0 is 1.2 s before the first note.
    expect(started).toHaveBeenCalledWith(10_000 + 60 - 1200)
    clock = 5.56
    expect(pianoPosition()).toBeCloseTo(1.7, 9)
  })

  test('ends by itself once the last note has rung', async () => {
    const ended = vi.fn()
    playPiano(notes.slice(0, 2), { onEnded: ended })
    await settle()
    clock = 6
    await vi.advanceTimersByTimeAsync(200)
    expect(ended).not.toHaveBeenCalled()
    clock = 6.2
    await vi.advanceTimersByTimeAsync(200)
    expect(ended).toHaveBeenCalledTimes(1)
    expect(pianoPosition()).toBeNull()
  })

  test('stopping silences what’s scheduled, and reports the end once', async () => {
    const ended = vi.fn()
    playPiano(notes, { onEnded: ended })
    await settle()
    clock = 5.5
    stopPiano()
    stopPiano()
    expect(ended).toHaveBeenCalledTimes(1)
    expect(sources.every(s => s.stops.at(-1) === 5.53)).toBe(true)
    clock = 9
    await vi.advanceTimersByTimeAsync(1000)
    // Nothing more is scheduled.
    expect(struck()).toHaveLength(3)
  })

  test('plays notes given out of order in the order they start', async () => {
    playPiano([...notes.slice(0, 3)].reverse())
    await settle()
    expect(struck().map(n => n.midi)).toEqual([48, 49, 50])
  })

  test('starting another stops this one without calling its onEnded', async () => {
    const first = vi.fn()
    const second = vi.fn()
    playPiano(notes, { onEnded: first })
    await settle()
    playPiano(notes.slice(0, 1), { onEnded: second })
    await settle()
    expect(first).not.toHaveBeenCalled()
    stopPiano()
    expect(second).toHaveBeenCalledTimes(1)
  })

  test('a stop before the context resumes schedules nothing', async () => {
    const ended = vi.fn()
    playPiano(notes, { onEnded: ended })
    stopPiano()
    await settle()
    expect(struck()).toEqual([])
    expect(ended).toHaveBeenCalledTimes(1)
  })

  test('ends when its context closes', async () => {
    const ended = vi.fn()
    playPiano(notes, { onEnded: ended })
    await settle()
    for (const stop of closing) stop(context)
    expect(ended).toHaveBeenCalledTimes(1)
  })
})
