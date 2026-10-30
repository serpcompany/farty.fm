'use client'

import { CircleAlert, Play, Square } from 'lucide-react'
import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { forgetTake, keepTake, keptTake } from '@/lib/pad-take'
import {
  MAX_PERFORMANCE_SECONDS,
  MAX_TAPS,
  type Performance,
  performanceOf,
  type Tap
} from '@/lib/performance'
import { reportError } from '@/lib/telemetry/errors'
import { formattedTootLength, type PadToot, type PadTootDraft } from '@/lib/toot'
import { type CheckoutReturn, clearCheckoutReturn, readCheckoutReturn } from '@/lib/toot-payment'
import { TootError } from '@/lib/toot-renderer'
import { cn } from '@/lib/utils'
import { tootPlayback, usePedos } from './pedos-provider'

// The Sound Pad's take (#278, ADR 0016): Record, play the Pads, Stop, and the taps become a
// Performance, made into a Toot in the render worker. Hearing it is free; Save to Toots saves it
// as any Toot (ADR 0010).

type Phase =
  | { kind: 'idle' }
  /** `firstTapAt`: when the first tap played (`performance.now()`), the take's start. */
  | { kind: 'recording'; firstTapAt: number | null }
  | { kind: 'making'; played: Performance; id?: string; back: CheckoutReturn | null }
  | { kind: 'ready'; draft: PadTootDraft; back: CheckoutReturn | null }
  | { kind: 'failed'; played: Performance; id?: string; back: CheckoutReturn | null }

export type PadTake = {
  phase: Phase
  /** Seconds since the take's first tap, while recording. */
  elapsed: number
  record(): void
  stop(): void
  /** A Pad played `recordingId` at `at` (an event's `timeStamp`, in ms): kept while recording. */
  tapped(at: number, recordingId: string): void
  /** Makes the Toot of a take that failed again. */
  retry(): void
}

/**
 * The Sound Pad's take: up to `MAX_PERFORMANCE_SECONDS` from its first tap, or `MAX_TAPS` taps,
 * then it stops by itself, as hiding the page does. Made, it plays once, and is kept in this
 * browser (`pad-take.ts`) until it's saved or another take is made, so back from Checkout the
 * same Toot is made again with the id it was paid for.
 */
export function usePadTake(): PadTake {
  const pedos = usePedos()
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [elapsed, setElapsed] = useState(0)
  const taps = useRef<Tap[] | null>(null)
  const loaded = pedos.recordings !== null

  const stop = () => {
    if (taps.current === null) return
    const played = performanceOf(taps.current)
    taps.current = null
    setPhase(played ? { kind: 'making', played, back: null } : { kind: 'idle' })
  }
  const stopByItself = useEffectEvent(stop)

  const record = () => {
    pedos.stopPlayback()
    taps.current = []
    setElapsed(0)
    setPhase({ kind: 'recording', firstTapAt: null })
  }

  const tapped = (at: number, recordingId: string) => {
    if (taps.current === null) return
    // A Performance is timed in seconds.
    taps.current.push({ at: at / 1000, recordingId })
    setPhase(current =>
      current.kind === 'recording' && current.firstTapAt === null
        ? { kind: 'recording', firstTapAt: at }
        : current
    )
    if (taps.current.length >= MAX_TAPS) stop()
  }

  // The clock, from the first tap, and the stop at the longest take.
  const firstTapAt = phase.kind === 'recording' ? phase.firstTapAt : null
  useEffect(() => {
    if (firstTapAt === null) return
    const tick = () => {
      const seconds = (window.performance.now() - firstTapAt) / 1000
      if (seconds >= MAX_PERFORMANCE_SECONDS) stopByItself()
      else setElapsed(seconds)
    }
    tick()
    const timer = setInterval(tick, 200)
    return () => clearInterval(timer)
  }, [firstTapAt])

  // Hiding the page stops the take, as it stops the Pads.
  useEffect(() => {
    const visibilityChanged = () => {
      if (document.visibilityState === 'hidden') stopByItself()
    }
    document.addEventListener('visibilitychange', visibilityChanged)
    return () => document.removeEventListener('visibilitychange', visibilityChanged)
  }, [])

  // Back from Checkout for the kept take: the same Toot is made again. Any other return is gone.
  useEffect(() => {
    const back = readCheckoutReturn()
    if (!back) return
    const kept = keptTake()
    if (kept?.tootId === back.tootId) {
      setPhase({ kind: 'making', played: kept.performance, id: kept.tootId, back })
    } else clearCheckoutReturn()
  }, [])

  const make = useEffectEvent((played: Performance, id?: string) => pedos.makePadToot(played, id))
  const playOnce = useEffectEvent((draft: PadTootDraft) => {
    // A page opened from a link or a reload can't start sound before a tap.
    if (navigator.userActivation?.hasBeenActive ?? true) pedos.toggleTootPlayback(draft)
  })
  const making = phase.kind === 'making' ? phase : null
  useEffect(() => {
    if (!making || !loaded) return
    let left = false
    make(making.played, making.id).then(
      draft => {
        if (left) return
        keepTake(draft.id, draft.performance)
        setPhase({ kind: 'ready', draft, back: making.back })
        // Back from Checkout, the take was heard already: it waits for a tap.
        if (!making.back) playOnce(draft)
      },
      error => {
        // "Couldn't make this Toot": reported by the error that caused it, such as a decode.
        reportError('toot-make-failed', error instanceof TootError ? (error.cause ?? error) : error)
        if (!left) setPhase({ ...making, kind: 'failed' })
      }
    )
    return () => {
      left = true
    }
  }, [making, loaded])

  // Saved, the take isn't kept any more. Leaving the screen stops it and lets go of its audio.
  const { stopPlayback, forgetToot } = pedos
  const draftId = phase.kind === 'ready' ? phase.draft.id : null
  const isSaved = draftId !== null && pedos.toot(draftId) !== undefined
  useEffect(() => {
    if (isSaved && draftId) forgetTake(draftId)
  }, [isSaved, draftId])
  useEffect(() => stopPlayback, [stopPlayback])
  useEffect(() => {
    if (draftId) return () => forgetToot(draftId)
  }, [draftId, forgetToot])

  const retry = () => {
    if (phase.kind === 'failed') setPhase({ ...phase, kind: 'making' })
  }

  return { phase, elapsed, record, stop, tapped, retry }
}

/**
 * Under the Pads: Record, or Stop with the take's clock; then the Toot made from it, to hear, with
 * Record again. Save to Toots is the screen's, pinned above the tabs.
 */
export function PadTakeControls({ take, disabled }: { take: PadTake; disabled: boolean }) {
  const { phase } = take
  if (phase.kind === 'idle' || phase.kind === 'recording') {
    const recording = phase.kind === 'recording'
    const started = recording && phase.firstTapAt !== null
    return (
      <div className="flex items-center gap-4">
        <button
          type="button"
          aria-label={recording ? 'Stop recording' : 'Record'}
          data-testid={recording ? 'pad-take-stop' : 'pad-take-record'}
          disabled={disabled}
          className="flex size-14 shrink-0 items-center justify-center rounded-full border-4 border-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
          onClick={recording ? take.stop : take.record}
        >
          <span
            aria-hidden
            className={cn(
              'bg-record transition-all duration-300',
              recording ? 'size-5 rounded-[5px]' : 'size-10 rounded-full'
            )}
          />
        </button>
        <div className="min-w-0" aria-live="polite">
          <p className="font-semibold tabular-nums" data-testid="pad-take-state">
            {started
              ? `${formattedTootLength(Math.floor(take.elapsed))} of ${formattedTootLength(MAX_PERFORMANCE_SECONDS)}`
              : recording
                ? 'Recording'
                : 'Record'}
          </p>
          <p className="text-sm text-muted-foreground">
            {started
              ? 'Tap Stop to hear it.'
              : recording
                ? 'It starts at your first tap.'
                : `Play up to ${MAX_PERFORMANCE_SECONDS} s, then hear it back.`}
          </p>
        </div>
      </div>
    )
  }
  if (phase.kind === 'making') {
    return (
      <div className="flex items-center gap-4 text-muted-foreground">
        <span className="flex size-14 shrink-0 items-center justify-center">
          <Spinner className="size-6" />
        </span>
        <p>Making your Toot…</p>
      </div>
    )
  }
  if (phase.kind === 'failed') {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-muted-foreground">Couldn't make this Toot.</p>
        <div className="flex gap-3">
          <Button variant="outline" className="h-11 px-5 text-base" onClick={take.retry}>
            Try again
          </Button>
          <Button variant="ghost" className="h-11 px-5 text-base" onClick={take.record}>
            Record again
          </Button>
        </div>
      </div>
    )
  }
  return (
    <PadTootLayout toot={phase.draft}>
      <Button
        variant="outline"
        className="mt-2 h-9 px-3"
        data-testid="pad-take-again"
        onClick={take.record}
      >
        Record again
      </Button>
    </PadTootLayout>
  )
}

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`

/**
 * A Sound Pad Toot's Play, its state, and what it played: the take just made, or a saved one (its
 * Toot screen). When its audio is missing, Play can't play. `children` are more lines under it.
 */
export function PadTootLayout({
  toot,
  isAudioMissing = false,
  children
}: {
  toot: PadTootDraft | PadToot
  isAudioMissing?: boolean
  children?: ReactNode
}) {
  const pedos = usePedos()
  const isPlaying = pedos.nowPlaying === tootPlayback(toot.id)
  const { taps, recordings } = toot.performance

  return (
    <div className="flex items-start gap-4">
      <button
        type="button"
        aria-label={isAudioMissing ? 'Audio missing' : isPlaying ? 'Stop' : 'Play'}
        data-testid="pad-toot-play"
        disabled={isAudioMissing}
        className={cn(
          'flex size-14 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
          isAudioMissing
            ? 'bg-muted text-muted-foreground'
            : isPlaying
              ? 'bg-primary text-primary-foreground'
              : 'bg-primary/10 text-primary'
        )}
        onClick={() => pedos.toggleTootPlayback(toot)}
      >
        {isAudioMissing ? (
          <CircleAlert className="size-6" />
        ) : isPlaying ? (
          <Square className="size-5 fill-current" />
        ) : (
          <Play className="size-6 fill-current" />
        )}
      </button>
      <div className="min-w-0">
        <p className="font-semibold" data-testid="pad-toot-state">
          {isAudioMissing
            ? 'Audio missing'
            : isPlaying
              ? 'Playing'
              : pedos.tootPlayFailed === toot.id
                ? "Couldn't play"
                : 'Ready'}
        </p>
        <p className="text-sm text-muted-foreground tabular-nums">
          {formattedTootLength(toot.seconds)} · {plural(taps.length, 'tap')} of{' '}
          {plural(recordings.length, 'Recording')}
        </p>
        {children}
      </div>
    </div>
  )
}
