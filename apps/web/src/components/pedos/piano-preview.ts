import { audioContext, isClosed, setPlaybackSession, whenClosing } from '@/lib/audio/context'
import type { Song } from '@/lib/catalog/song'
import { GAP_SECONDS, SHORTEST_NOTE_SECONDS } from '@/lib/engine/renderer'
import { pianoBuffer, strikePianoNote } from './piano-keys'

// A Song's melody on piano (#359): Song Creator's Piano and a locked Song's "Play on piano", to
// hear the tune before or without the farts. The review's piano note, struck ahead of time on the
// shared AudioContext. It goes straight to the speakers, never into a render, a Toot, a share or a
// saved file (ADR 0015 rule 3): nothing that makes or saves audio imports this module
// (`piano-boundary.test.ts`).

/** A note as the piano plays it: its MIDI note, and when it starts and how long it's held, in seconds. */
export type PianoNote = { midi: number; start: number; seconds: number }

/**
 * `song`'s notes as the piano plays them: each at its pitch moved by `transposition`, the key the
 * farts play it in, at the Song's tempo, and held for its length less the renderer's gap between
 * notes, as a fart is. In the Song's order, so each is at its note's index.
 */
export function pianoSchedule(
  song: Pick<Song, 'bpm' | 'notes'>,
  transposition: number
): PianoNote[] {
  const beat = 60 / song.bpm
  return song.notes.map(note => ({
    midi: note.pitch + transposition,
    start: note.start * beat,
    seconds: Math.max(SHORTEST_NOTE_SECONDS, note.dur * beat - GAP_SECONDS)
  }))
}

/** A note let go fades out over this. */
export const RELEASE_SECONDS = 0.08
/** How far after the tap the first note plays, so it's never late. */
const LEAD_SECONDS = 0.06
/** How far ahead of the clock notes are scheduled, and how often more are. */
const AHEAD_SECONDS = 1.5
const TICK_MS = 200
/** A note `from` leaves less of than this isn't played. */
const SHORTEST_HELD_SECONDS = 0.03

/** The piano playing, or null. */
let current: {
  context: AudioContext
  /** Stops what's scheduled, and reports the end unless `report` is false. Once. */
  end: (report?: boolean) => void
  /** Where it is in the notes, in seconds; null until its first note is scheduled. */
  position: () => number | null
} | null = null

export type PianoOptions = {
  /** Where in the notes to start, in seconds: a note already sounding there plays what's left. */
  from?: number
  /**
   * Once the first notes are scheduled: the `performance.now()` at which the notes' 0 would have
   * reached the speaker, for a playhead to follow.
   */
  onStarted?: (zeroAt: number) => void
  /** Once: when the last note has rung, when it's stopped, or when its context closes. */
  onEnded?: () => void
}

/**
 * Plays `notes` on piano on the shared AudioContext, scheduling them a little ahead as it goes.
 * One plays at a time, as Farty's player: starting another stops this one without calling its
 * `onEnded`.
 */
export function playPiano(notes: readonly PianoNote[], options: PianoOptions = {}): void {
  const { from = 0, onStarted, onEnded } = options
  const byStart = [...notes].sort((a, b) => a.start - b.start)
  current?.end(false)
  const context = audioContext()
  setPlaybackSession()
  const output = context.createGain()
  output.connect(context.destination)
  const sounding: { note: AudioBufferSourceNode; end: number }[] = []
  let next = 0
  /** Where `from` plays on the context's clock, once the context runs. */
  let zero: number | null = null
  let lastEnd = 0
  let timer: ReturnType<typeof setInterval> | undefined
  let ended = false

  const end = (report = true) => {
    if (ended) return
    ended = true
    clearInterval(timer)
    if (current === playing) current = null
    const now = context.currentTime
    output.gain.cancelScheduledValues(now)
    output.gain.setValueAtTime(output.gain.value, now)
    output.gain.linearRampToValueAtTime(0, now + 0.02)
    for (const voice of sounding) stopAt(voice.note, now + 0.03)
    setTimeout(() => output.disconnect(), 100)
    if (report) onEnded?.()
  }

  const schedule = () => {
    if (ended || zero === null) return
    const now = context.currentTime
    while (next < byStart.length && zero + byStart[next].start - from < now + AHEAD_SECONDS) {
      const note = byStart[next]
      next += 1
      const start = Math.max(note.start, from)
      const held = note.start + note.seconds - start
      // A note over by `from`, or all but, isn't played.
      if (held < SHORTEST_HELD_SECONDS) continue
      const at = zero + start - from
      // Held for its length, then let go: a damper on the note as struck.
      const release = at + held
      const damper = context.createGain()
      damper.gain.setValueAtTime(1, release)
      damper.gain.exponentialRampToValueAtTime(0.0001, release + RELEASE_SECONDS)
      damper.connect(output)
      const struck = strikePianoNote(context, damper, note.midi, at)
      // It rings out by itself once its buffer ends.
      const stops = Math.min(at + (struck.buffer?.duration ?? 0), release + RELEASE_SECONDS + 0.02)
      stopAt(struck, stops)
      sounding.push({ note: struck, end: stops })
      lastEnd = Math.max(lastEnd, stops)
    }
    // The ones that have stopped are let go.
    for (let i = sounding.length - 1; i >= 0; i--) {
      if (sounding[i].end < now) sounding.splice(i, 1)
    }
    if (next >= byStart.length && now >= lastEnd) end()
  }

  const playing = {
    context,
    end,
    position: () =>
      zero === null ? null : from + Math.max(0, context.currentTime - zero - outputLatency(context))
  }
  current = playing

  context
    .resume()
    .catch(() => {})
    .then(() => {
      if (ended) return
      // A context closed or closing since, as one replaced after a hide, plays nothing.
      if (isClosed(context)) {
        end()
        return
      }
      // The first notes are built before the clock is read, so building them never makes one late.
      // Later ones are built 1.3 s or more before they play.
      for (const note of byStart) {
        if (note.start - from >= AHEAD_SECONDS) break
        if (note.start + note.seconds > from) pianoBuffer(context, note.midi)
      }
      zero = context.currentTime + LEAD_SECONDS
      onStarted?.(performance.now() + (LEAD_SECONDS + outputLatency(context) - from) * 1000)
      schedule()
      if (!ended) timer = setInterval(schedule, TICK_MS)
    })
}

/** Stops the piano, if it's playing, and reports its end. */
export function stopPiano(): void {
  current?.end()
}

/** Where the piano playing is in its notes, in seconds; null while none plays or it's starting. */
export function pianoPosition(): number | null {
  return current?.position() ?? null
}

/**
 * The output's latency, which the clock runs ahead of the speaker by, where the browser reports
 * it, as `playbackPosition` takes it off.
 */
function outputLatency(context: AudioContext): number {
  const reported = Number(context.outputLatency ?? 0)
  return Number.isFinite(reported) && reported > 0 ? reported : 0
}

function stopAt(note: AudioBufferSourceNode, at: number): void {
  try {
    note.stop(at)
  } catch {
    // A browser that takes only one stop: the damper and output silence it anyway.
  }
}

// Closing a context ends what plays on it without a word, so the piano reports its end first.
whenClosing(context => {
  if (current?.context === context) current.end()
})
