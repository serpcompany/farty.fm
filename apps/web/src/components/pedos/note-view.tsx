'use client'

import {
  type MouseEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import type { Song, SongNote } from '@/lib/catalog/song'
import { noteName } from '@/lib/pitch'
import { noteSeconds, soundingPitch, type TootArrangement } from '@/lib/toot'

/** The iPhone's system colors for a Song's pitches, lowest first. Red is kept for recording. */
const colors = [
  '#007AFF', // blue
  '#34C759', // green
  '#FF9500', // orange
  '#AF52DE', // purple
  '#30B0C7', // teal
  '#FF2D55', // pink
  '#5856D6', // indigo
  '#A2845E', // brown
  '#00C7BE', // mint
  '#32ADE6', // cyan
  '#FFCC00' // yellow
]

/** The color of the Song's `index`th pitch, lowest first, and of the Recording that plays it. */
export function pitchColor(index: number): string {
  return colors[index % colors.length]
}

/** The note view's height, as on the iPhone: 180 points, padding included. */
const height = 180
const padding = 12

/**
 * A read-only view of a Song's notes over time, each colored by the Recording that plays it, with
 * a playhead while it plays. Tapping picks the nearest note; each note is also its own button for
 * a screen reader or a keyboard. As the iPhone app's `NoteView`.
 */
export function NoteView({
  song,
  arrangement,
  recordingName,
  startedAt,
  highlightedPitch,
  selectedNote,
  playingNote,
  onTapNote
}: {
  song: Song
  arrangement: TootArrangement
  /** The name of the Recording that plays a note: "Recording 3". */
  recordingName: (note: SongNote) => string
  /** When the whole Song started playing (`performance.now()`); null when it isn't playing. */
  startedAt: number | null
  /** Notes of this pitch (one Recording's) stand out; the others dim. */
  highlightedPitch: number | null
  selectedNote: number | null
  playingNote: number | null
  onTapNote: (index: number) => void
}) {
  const area = useRef<HTMLDivElement>(null)
  const width = useWidth(area)
  const layout = new Layout(song, width, height - 2 * padding)
  const beat = usePlayheadBeat(startedAt, song.bpm)
  const colorIndex = (note: SongNote) => Math.max(0, song.pitches.indexOf(note.pitch))

  const opacity = (note: SongNote) => {
    if (highlightedPitch !== null) return note.pitch === highlightedPitch ? 1 : 0.2
    if (beat !== null) return note.start <= beat && beat < note.start + note.dur ? 1 : 0.45
    return 1
  }

  const tap = (event: MouseEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const index = layout.nearestNote(event.clientX - box.left, event.clientY - box.top, song.notes)
    if (index !== null) onTapNote(index)
  }

  /** "F3 at 1.4 s, Recording 21", then selected, highlighted and playing. */
  const label = (index: number) => {
    const note = song.notes[index]
    const start = noteSeconds(song, note).start.toFixed(1)
    return [
      `${noteName(soundingPitch(arrangement, note.pitch))} at ${start} s`,
      recordingName(note),
      index === selectedNote && 'selected',
      highlightedPitch === note.pitch && 'highlighted',
      index === playingNote && 'playing'
    ]
      .filter(Boolean)
      .join(', ')
  }

  return (
    <fieldset
      data-testid="note-view"
      className="m-0 min-w-0 rounded-2xl border-0 bg-muted/60"
      style={{ padding }}
    >
      <legend className="sr-only">Notes</legend>
      {/* The whole view is the hit target: a tap picks the nearest note. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: each note is a button too */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: each note is a button too */}
      <div
        ref={area}
        className="relative cursor-pointer"
        style={{ height: height - 2 * padding }}
        onClick={tap}
      >
        <svg
          width={width}
          height={layout.height}
          aria-hidden="true"
          className="absolute inset-0 overflow-visible"
        >
          {layout.bars().map(bar => (
            <rect
              key={bar}
              x={layout.x(bar)}
              y={0}
              width={1}
              height={layout.height}
              className="fill-border"
            />
          ))}
          {song.notes.map((note, index) => {
            const r = layout.rect(note)
            return (
              // Notes never reorder, so the index is a stable key.
              // biome-ignore lint/suspicious/noArrayIndexKey: a Song's notes are fixed
              <g key={index} data-note={index + 1}>
                <rect
                  x={r.x}
                  y={r.y}
                  width={r.width}
                  height={r.height}
                  rx={r.height / 2}
                  fill={pitchColor(colorIndex(note))}
                  opacity={opacity(note)}
                />
                {index === selectedNote && (
                  <rect
                    x={r.x - 3}
                    y={r.y - 3}
                    width={r.width + 6}
                    height={r.height + 6}
                    rx={r.height / 2 + 3}
                    fill="none"
                    strokeWidth={2}
                    className="stroke-foreground"
                    data-testid="selected-note"
                  />
                )}
              </g>
            )
          })}
          {beat !== null && beat <= layout.beats && (
            <rect
              x={layout.x(beat) - 1}
              y={0}
              width={2}
              height={layout.height}
              className="fill-foreground"
              data-testid="playhead"
            />
          )}
        </svg>
        {song.notes.map((note, index) => {
          const r = layout.rect(note)
          return (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: a Song's notes are fixed
              key={index}
              type="button"
              aria-label={label(index)}
              data-testid={`note ${index + 1}`}
              // Taps go to the view, which picks the nearest note; the button is for a screen
              // reader and the keyboard.
              className="pointer-events-none absolute rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              style={{ left: r.x, top: r.y, width: r.width, height: r.height }}
              onClick={event => {
                event.stopPropagation()
                onTapNote(index)
              }}
            />
          )
        })}
      </div>
    </fieldset>
  )
}

/** Where notes sit in the view: time across, pitch up. As the iPhone's `NoteView.Layout`. */
class Layout {
  readonly beats: number
  private readonly low: number
  private readonly high: number
  private readonly noteHeight: number

  constructor(
    song: Song,
    readonly width: number,
    readonly height: number
  ) {
    this.beats = Math.max(song.length_beats, 1)
    this.low = (song.pitches[0] ?? 60) - 1
    this.high = (song.pitches[song.pitches.length - 1] ?? 60) + 1
    this.noteHeight = Math.min(10, height / Math.max(this.high - this.low, 1))
  }

  x(beat: number): number {
    return (this.width * beat) / this.beats
  }

  /** A faint line every bar of 4 beats. */
  bars(): number[] {
    const bars: number[] = []
    for (let bar = 4; bar < this.beats; bar += 4) bars.push(bar)
    return bars
  }

  rect(note: SongNote) {
    const x = this.x(note.start)
    return {
      x,
      y: ((this.height - this.noteHeight) * (this.high - note.pitch)) / (this.high - this.low),
      width: Math.max(4, this.x(note.start + note.dur) - x - 2),
      height: this.noteHeight
    }
  }

  /** The note closest to the point: zero distance inside it. */
  nearestNote(px: number, py: number, notes: readonly SongNote[]): number | null {
    let nearest: number | null = null
    let best = Number.POSITIVE_INFINITY
    notes.forEach((note, index) => {
      const r = this.rect(note)
      const dx = Math.max(r.x - px, 0, px - (r.x + r.width))
      const dy = Math.max(r.y - py, 0, py - (r.y + r.height))
      const distance = Math.hypot(dx, dy)
      if (distance < best) {
        best = distance
        nearest = index
      }
    })
    return nearest
  }
}

/** The element's width, kept current as it resizes. */
function useWidth(element: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  // Before the first paint, so notes never show squeezed at the left.
  useLayoutEffect(() => {
    const target = element.current
    if (!target) return
    setWidth(target.clientWidth)
    const observer = new ResizeObserver(() => setWidth(target.clientWidth))
    observer.observe(target)
    return () => observer.disconnect()
  }, [element])
  return width
}

/** Where the playhead is, in beats, every frame while the Song plays; null when it doesn't. */
function usePlayheadBeat(startedAt: number | null, bpm: number): number | null {
  const [beat, setBeat] = useState<number | null>(null)
  useEffect(() => {
    if (startedAt === null) {
      setBeat(null)
      return
    }
    let frame = 0
    const tick = () => {
      setBeat((((performance.now() - startedAt) / 1000) * bpm) / 60)
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [startedAt, bpm])
  return beat
}
