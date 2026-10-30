'use client'

import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from 'react'
import type { Trim } from '@/lib/recordings'
import { cn } from '@/lib/utils'

/** Loudness bars, 0…1 each, as the iPhone app's `WaveformView`. */
export function Waveform({
  levels,
  isPlaying = false,
  className
}: {
  levels: number[]
  isPlaying?: boolean
  className?: string
}) {
  return (
    <div aria-hidden className={cn('flex items-center gap-[2px]', className)}>
      {levels.map((level, i) => (
        <span
          // Bars never reorder, so the index is a stable key.
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length, static list
          key={i}
          className={cn(
            'min-h-[2px] flex-1 rounded-full',
            isPlaying ? 'bg-primary' : 'bg-muted-foreground/60'
          )}
          style={{ height: `${Math.max(level, 0.05) * 100}%` }}
        />
      ))}
    </div>
  )
}

/** How far a press moves, in CSS pixels, before it scrubs rather than taps. */
const SCRUB_PIXELS = 6

/** The shortest fart a Trim's handles leave between them, in seconds. */
export const SHORTEST_TRIM_SECONDS = 0.05

/** A time in a take as the picker reads it out: "1.20 s". */
export const formattedTime = (seconds: number) => `${seconds.toFixed(2)} s`

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

/**
 * A replay's waveform (#293): `levels` drawn across `view`, a stretch of the take in seconds, with
 * a playhead line that follows `position` (the audio clock) while `playing` plays, and the bars it
 * has passed filled in. With `label`, it's a slider: a tap plays from that spot, a drag scrubs
 * and plays from where it lets go (`onPlayFrom`), and the arrow keys jump a twelfth of the view.
 * With `trim`, it also has the picker's handles, and with `window`, it's the small strip of the
 * whole take with a box where the view above sits.
 */
export function ReplayWaveform({
  levels,
  view,
  playing,
  position,
  dim,
  window: shown,
  label,
  onPlayFrom,
  onScrubStart,
  trim,
  small = false,
  className
}: {
  levels: number[]
  view: Trim
  /** The part of the take playing now, or null while this take isn't. */
  playing: Trim | null
  /** Where the take plays now, in seconds of it, by the audio clock. */
  position: () => number | null
  /** Bars outside it draw dimmer: the take around the fart. */
  dim?: Trim
  window?: Trim
  label?: string
  onPlayFrom?: (seconds: number) => void
  /** A press became a scrub: playback stops while it scrubs. */
  onScrubStart?: () => void
  trim?: { part: Trim; onChange: (part: Trim, done: boolean) => void }
  /** The thin strip under the picker's waveform: no fill, a thinner line. */
  small?: boolean
  className?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState<number | null>(null)
  const [scrubAt, setScrubAt] = useState<number | null>(null)
  const span = Math.max(1e-6, view.endSeconds - view.startSeconds)
  const from = playing?.startSeconds ?? null

  // While it plays, the playhead reads the audio clock each frame.
  useEffect(() => {
    if (from === null) {
      setNow(null)
      return
    }
    let frame = 0
    const tick = () => {
      setNow(position())
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [from, position])

  const at = scrubAt ?? (from === null ? null : now)
  const x = at === null ? null : (at - view.startSeconds) / span
  const timeAt = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return view.startSeconds
    return view.startSeconds + clamp((clientX - rect.left) / rect.width, 0, 1) * span
  }

  const press = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    if ((event.target as HTMLElement).closest('[data-handle]')) return
    const element = event.currentTarget
    const pointer = event.pointerId
    const x0 = event.clientX
    let scrubbing = false
    element.setPointerCapture?.(pointer)
    const move = (moved: globalThis.PointerEvent) => {
      if (!scrubbing && Math.abs(moved.clientX - x0) <= SCRUB_PIXELS) return
      if (!scrubbing) {
        scrubbing = true
        onScrubStart?.()
      }
      setScrubAt(timeAt(moved.clientX))
    }
    const finish = () => {
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerup', up)
      element.removeEventListener('pointercancel', finish)
      setScrubAt(null)
    }
    const up = (lifted: globalThis.PointerEvent) => {
      finish()
      onPlayFrom?.(timeAt(lifted.clientX))
    }
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerup', up)
    element.addEventListener('pointercancel', finish)
  }

  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    if ((event.target as HTMLElement).closest('[data-handle]')) return
    event.preventDefault()
    const here = at ?? view.startSeconds
    const step = (event.key === 'ArrowLeft' ? -1 : 1) * (span / 12)
    onPlayFrom?.(clamp(here + step, view.startSeconds, view.endSeconds))
  }

  const percent = (seconds: number) =>
    `${(((seconds - view.startSeconds) / span) * 100).toFixed(3)}%`
  const width = (part: Trim) =>
    `${(((part.endSeconds - part.startSeconds) / span) * 100).toFixed(3)}%`
  const bar = span / Math.max(1, levels.length)
  const drawn = (
    <>
      <span
        className={cn(
          'pointer-events-none absolute inset-0 flex items-center',
          small ? 'gap-px' : 'gap-[2px]'
        )}
      >
        {levels.map((level, i) => {
          const mid = view.startSeconds + (i + 0.5) * bar
          const dimmed = dim && (mid < dim.startSeconds || mid > dim.endSeconds)
          const played =
            !small && scrubAt === null && from !== null && now !== null
              ? mid + bar / 2 >= from && mid - bar / 2 <= now
              : false
          return (
            <span
              // Bars never reorder, so the index is a stable key.
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length, static list
              key={i}
              className={cn(
                'min-w-0 flex-1 rounded-full',
                small ? 'min-h-px' : 'min-h-[2px]',
                played ? 'bg-primary' : dimmed ? 'bg-muted-foreground/30' : 'bg-muted-foreground/60'
              )}
              style={{ height: `${Math.max(level, 0.05) * 100}%` }}
            />
          )
        })}
      </span>
      {shown && (
        <span
          className="pointer-events-none absolute -top-1 -bottom-1 rounded-sm border-[1.5px] border-foreground/55"
          style={{ left: percent(shown.startSeconds), width: width(shown) }}
        />
      )}
      {trim && <TrimHandles view={view} {...trim} />}
      {x !== null && x >= 0 && x <= 1 && (
        <span
          className={cn(
            'pointer-events-none absolute z-[3] rounded-full bg-brand-strong dark:bg-brand',
            small
              ? '-top-[3px] -bottom-[3px] -ml-[0.75px] w-[1.5px]'
              : '-top-[5px] -bottom-[5px] -ml-px w-[2px]'
          )}
          style={{ left: `${(x * 100).toFixed(3)}%` }}
          data-testid={small ? undefined : 'playhead'}
        />
      )}
    </>
  )
  const base = 'relative min-w-0 touch-pan-y [-webkit-tap-highlight-color:transparent]'

  if (!label || !onPlayFrom) {
    return (
      <div ref={box} aria-hidden className={cn(base, className)}>
        {drawn}
      </div>
    )
  }
  return (
    <div
      ref={box}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={Number(view.startSeconds.toFixed(2))}
      aria-valuemax={Number(view.endSeconds.toFixed(2))}
      aria-valuenow={Number((at ?? view.startSeconds).toFixed(2))}
      aria-valuetext="Play from a spot"
      className={cn(
        base,
        'cursor-pointer rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        className
      )}
      onPointerDown={press}
      onKeyDown={key}
      data-testid="replay-waveform"
    >
      {drawn}
    </div>
  )
}

/**
 * The picker's Trim handles over the zoomed waveform (ADR 0019): a pink frame around the part
 * kept, the rest shaded, and a handle at each end. Drag one, or focus it and use the arrow keys
 * (a hundredth of a second, a tenth with Shift).
 */
function TrimHandles({
  view,
  part,
  onChange
}: {
  view: Trim
  part: Trim
  onChange: (part: Trim, done: boolean) => void
}) {
  const span = Math.max(1e-6, view.endSeconds - view.startSeconds)
  const s = `${(((part.startSeconds - view.startSeconds) / span) * 100).toFixed(3)}%`
  const e = `${(((part.endSeconds - view.startSeconds) / span) * 100).toFixed(3)}%`

  const moved = (which: 'start' | 'end', seconds: number): Trim => {
    const t = Math.round(seconds * 100) / 100
    return which === 'start'
      ? {
          startSeconds: clamp(t, view.startSeconds, part.endSeconds - SHORTEST_TRIM_SECONDS),
          endSeconds: part.endSeconds
        }
      : {
          startSeconds: part.startSeconds,
          endSeconds: clamp(t, part.startSeconds + SHORTEST_TRIM_SECONDS, view.endSeconds)
        }
  }

  const drag = (which: 'start' | 'end') => (event: PointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const handle = event.currentTarget
    const frame = handle.closest('[data-trim]')?.getBoundingClientRect()
    if (!frame || frame.width === 0) return
    const timeAt = (clientX: number) =>
      view.startSeconds + clamp((clientX - frame.left) / frame.width, 0, 1) * span
    const value = which === 'start' ? part.startSeconds : part.endSeconds
    const grab = timeAt(event.clientX) - value
    let latest = part
    handle.setPointerCapture?.(event.pointerId)
    const move = (ev: globalThis.PointerEvent) => {
      latest = moved(which, timeAt(ev.clientX) - grab)
      onChange(latest, false)
    }
    const end = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
      onChange(latest, true)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }

  const nudge = (which: 'start' | 'end') => (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const step = (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 0.1 : 0.01)
    const value = which === 'start' ? part.startSeconds : part.endSeconds
    onChange(moved(which, value + step), true)
  }

  const handle = (which: 'start' | 'end') => {
    const value = which === 'start' ? part.startSeconds : part.endSeconds
    return (
      <span
        role="slider"
        tabIndex={0}
        data-handle={which}
        aria-label={which === 'start' ? 'Where the fart starts' : 'Where the fart ends'}
        aria-valuemin={Number(view.startSeconds.toFixed(2))}
        aria-valuemax={Number(view.endSeconds.toFixed(2))}
        aria-valuenow={Number(value.toFixed(2))}
        aria-valuetext={formattedTime(value)}
        className={cn(
          'pointer-events-auto absolute inset-y-0 w-[30px] cursor-ew-resize touch-none rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
          // The pink bar sits on the frame's edge, with a white grip; the rest is reach.
          "before:absolute before:inset-y-0 before:w-[13px] before:bg-brand-strong before:content-['']",
          "after:absolute after:top-1/2 after:-mt-[7px] after:h-[14px] after:w-[2px] after:rounded-[1px] after:bg-white after:content-['']",
          which === 'start'
            ? 'before:right-0 before:rounded-l-md after:right-[5.5px]'
            : 'before:left-0 before:rounded-r-md after:left-[5.5px]'
        )}
        style={which === 'start' ? { left: `calc(${s} - 30px)` } : { left: e }}
        onPointerDown={drag(which)}
        onKeyDown={nudge(which)}
      />
    )
  }

  return (
    <span data-trim className="pointer-events-none absolute inset-x-0 -inset-y-1.5 z-[2]">
      <span className="absolute inset-y-1.5 left-0 bg-popover/70" style={{ width: s }} />
      <span className="absolute inset-y-1.5 right-0 bg-popover/70" style={{ left: e }} />
      <span
        className="absolute inset-y-0 border-y-2 border-brand-strong"
        style={{ left: s, width: `calc(${e} - ${s})` }}
      />
      {handle('start')}
      {handle('end')}
    </span>
  )
}
