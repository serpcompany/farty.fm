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

const systemColors = {
  blue: '#007AFF',
  green: '#34C759',
  orange: '#FF9500',
  purple: '#AF52DE',
  teal: '#30B0C7',
  pink: '#FF2D55',
  indigo: '#5856D6',
  brown: '#A2845E',
  mint: '#00C7BE',
  cyan: '#32ADE6',
  yellow: '#FFCC00'
}
const colors = Object.values(systemColors)

export function pitchColor(index: number): string {
  return colors[index % colors.length]
}

const viewHeight = 180
const padding = 12

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
  recordingName: (note: SongNote) => string
  startedAt: number | null
  highlightedPitch: number | null
  selectedNote: number | null
  playingNote: number | null
  onTapNote: (index: number) => void
}) {
  const area = useRef<HTMLDivElement>(null)
  const width = useWidth(area)
  const layout = new Layout(song, width, viewHeight - 2 * padding)
  const beat = usePlayheadBeat(startedAt, song.bpm)
  const colorIndex = (note: SongNote) => Math.max(0, song.pitches.indexOf(note.pitch))

  const opacity = (note: SongNote) => {
    if (highlightedPitch !== null) return note.pitch === highlightedPitch ? 1 : 0.2
    if (beat !== null) return note.start <= beat && beat < note.start + note.dur ? 1 : 0.45
    return 1
  }

  const tapNearestNote = (event: MouseEvent<HTMLButtonElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const index = layout.nearestNote(event.clientX - box.left, event.clientY - box.top, song.notes)
    if (index !== null) onTapNote(index)
  }

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
      <div ref={area} className="relative" style={{ height: viewHeight - 2 * padding }}>
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          className="absolute inset-0 cursor-pointer"
          onClick={tapNearestNote}
        />
        <svg
          width={width}
          height={layout.height}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-visible"
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
              <g key={note.start} data-note={index + 1}>
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
              className="fill-foreground motion-reduce:hidden"
              data-testid="playhead"
            />
          )}
        </svg>
        {song.notes.map((note, index) => {
          const r = layout.rect(note)
          return (
            <button
              key={note.start}
              type="button"
              aria-label={label(index)}
              data-testid={`note ${index + 1}`}
              className="pointer-events-none absolute rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              style={{ left: r.x, top: r.y, width: r.width, height: r.height }}
              onClick={() => onTapNote(index)}
            />
          )
        })}
      </div>
    </fieldset>
  )
}

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

function useWidth(element: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
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
