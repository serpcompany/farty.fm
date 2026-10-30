'use client'

import { CircleAlert, Play, Square } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  forgetTake,
  type KeptTake,
  keepForCheckout,
  keepTake,
  keptTake,
  keptTakes
} from '@/lib/pad-take'
import {
  MAX_PERFORMANCE_SECONDS,
  MAX_TAPS,
  type Performance,
  performanceOf,
  type Tap
} from '@/lib/performance'
import { reportError } from '@/lib/telemetry/errors'
import { formattedTootLength, type PadToot, type PadTootDraft } from '@/lib/toot'
import {
  type CheckoutReturn,
  clearCheckoutReturn,
  readCheckoutReturn,
  saveAsksForPayment,
  tootPaymentState
} from '@/lib/toot-payment'
import { TootError } from '@/lib/toot-renderer'
import { cn } from '@/lib/utils'
import { useAccount } from './account-provider'
import { tootPlayback, usePedos } from './pedos-provider'

// The Sound Pad's take (#278, ADR 0017): Record, play the Pads, Stop, and the taps become a
// Performance, made into a Toot in the render worker. Hearing it is free; Save to Toots saves it
// as any Toot (ADR 0010).

/** A take being made into its Toot `id`, or that couldn't be. */
type Take = {
  played: Performance
  id: string
  /** The return from Checkout it's made for, or a paid take saved on the Pad's open. */
  back: CheckoutReturn | null
  /** Made, it plays once: a take just stopped on a page in view. */
  plays: boolean
  /** A kept take shown again on the Pad's open: where saving is free, let go if it can't be made. */
  restored: boolean
}

type Phase =
  /** `lost`: a paid take couldn't be made again, which the Pad says. */
  | { kind: 'idle'; lost?: boolean }
  /** `firstTapAt`: when the first tap played (`performance.now()`), the take's start. */
  | { kind: 'recording'; firstTapAt: number | null }
  | ({ kind: 'making' } & Take)
  | { kind: 'ready'; draft: PadTootDraft; back: CheckoutReturn | null }
  | ({ kind: 'failed' } & Take)

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
  /** Keeps the take made, before Checkout as `accountId`. False when this browser can't. */
  keep(accountId: string): boolean
}

/**
 * The Sound Pad's take: up to `MAX_PERFORMANCE_SECONDS` from its first tap, or `MAX_TAPS` taps,
 * then it stops by itself, as hiding the page does. Stopped, it's kept in this browser
 * (`pad-take.ts`) until it's saved, by its Toot id, and made: it plays once, unless the page is
 * hidden. Back from Checkout the same Toot is made again with the id it was paid for. Opened, the
 * Pad shows the newest kept take again, ready to play, and where saving is paid it asks the account
 * about each kept take: one paid whose return never loaded is made again and saved, one whose
 * payment a save used is let go, and nothing else is. A paid take that can't be made again is said
 * and reported, for a refund. Only this library's takes are read (`pad-take.ts`).
 */
export function usePadTake(): PadTake {
  const pedos = usePedos()
  const { account } = useAccount()
  const accountId = account.status === 'signedIn' ? account.id : null
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [elapsed, setElapsed] = useState(0)
  const taps = useRef<Tap[] | null>(null)
  const loaded = pedos.recordings !== null
  /** The library is read, so a kept take can be checked against its Recordings and Toots. */
  const libraryRead = loaded && pedos.toots !== null
  /** Record was pressed since the Pad opened: nothing kept takes its place any more. */
  const recorded = useRef(false)
  /** The phase, for a check that answers after it may have changed. */
  const shown = useRef(phase)
  useEffect(() => {
    shown.current = phase
  }, [phase])

  /** Stops the take, made into a Toot that plays once if `plays`. */
  const stopTake = (plays: boolean) => {
    if (taps.current === null) return
    const played = performanceOf(taps.current)
    taps.current = null
    if (!played) {
      setPhase({ kind: 'idle' })
      return
    }
    // Kept at once, so a page left before the Toot is made doesn't lose it.
    const id = crypto.randomUUID()
    keepTake(id, played)
    setPhase({ kind: 'making', played, id, back: null, plays, restored: false })
  }
  const stop = () => stopTake(true)
  const stopByItself = useEffectEvent(stopTake)

  const record = () => {
    pedos.stopPlayback()
    recorded.current = true
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
      if (seconds >= MAX_PERFORMANCE_SECONDS) stopByItself(true)
      else setElapsed(seconds)
    }
    tick()
    const timer = setInterval(tick, 200)
    return () => clearInterval(timer)
  }, [firstTapAt])

  // Hiding the page stops the take, as it stops the Pads. It's made, and waits to be played.
  useEffect(() => {
    const visibilityChanged = () => {
      if (document.visibilityState === 'hidden') stopByItself(false)
    }
    document.addEventListener('visibilitychange', visibilityChanged)
    return () => document.removeEventListener('visibilitychange', visibilityChanged)
  }, [])

  /** Whether every Recording the take played is still in the library, so it can be made again. */
  const canMake = (take: KeptTake) =>
    take.performance.recordings.every(id => pedos.recording(id) !== undefined)
  /**
   * What's on the Pad can give way to a kept take: nothing recorded, no Checkout return, and no
   * lost take being said.
   */
  const replaceable = () => {
    const current = shown.current
    if (recorded.current) return false
    if (current.kind === 'idle') return !current.lost
    return current.kind !== 'recording' && current.back === null
  }
  /** A paid take that can't be made again: said on the Pad, reported for a refund, let go. */
  const lose = (tootId: string) => {
    reportError('pad-paid-take-lost')
    forgetTake(tootId)
    setPhase({ kind: 'idle', lost: true })
  }

  // Opened: back from Checkout, the take it was for is made again. Otherwise the newest kept take
  // is shown again, ready to play. A kept take whose Toot is saved is let go.
  const opened = useEffectEvent(() => {
    const back = readCheckoutReturn()
    if (back) {
      const kept = keptTake(back.tootId)
      if (pedos.toot(back.tootId)) {
        forgetTake(back.tootId)
        clearCheckoutReturn()
      } else if (kept && canMake(kept)) {
        const take = { played: kept.performance, id: kept.tootId, back }
        setPhase({ kind: 'making', ...take, plays: false, restored: false })
        return
      } else if (back.done) {
        // Paid for, and gone: storage cleared, or a Recording deleted, since paying.
        clearCheckoutReturn()
        lose(back.tootId)
        return
      } else clearCheckoutReturn()
    }
    let restored = false
    for (const take of keptTakes()) {
      if (pedos.toot(take.tootId)) forgetTake(take.tootId)
      else if (!canMake(take)) {
        // Where saving is paid, the account says first whether it was paid for.
        if (!saveAsksForPayment()) forgetTake(take.tootId)
      } else if (!restored) {
        restored = true
        const { performance: played, tootId: id } = take
        setPhase({ kind: 'making', played, id, back: null, plays: false, restored: true })
      }
    }
  })
  const isOpen = useRef(false)
  useEffect(() => {
    if (!libraryRead || isOpen.current) return
    isOpen.current = true
    opened()
  }, [libraryRead])

  // Where saving is paid, each kept take's payment, as D1 has it: paid and unused (its return never
  // loaded), the take is made again and saved, as back from Checkout; used by a save, it's let go,
  // and off the Pad if it's there. Unpaid, or not known, it stays kept: a payment whose webhook
  // hasn't landed yet reads unpaid, and the next open asks again.
  const recover = useEffectEvent(async (accountId: string) => {
    for (const take of keptTakes()) {
      if (!replaceable()) return
      if (pedos.toot(take.tootId)) {
        forgetTake(take.tootId)
        continue
      }
      const state = await tootPaymentState(take.tootId, accountId)
      if (!replaceable()) return
      if (state === 'used') {
        forgetTake(take.tootId)
        const current = shown.current
        if (current.kind === 'ready' && current.draft.id === take.tootId) {
          pedos.stopPlayback()
          setPhase({ kind: 'idle' })
        } else if (
          (current.kind === 'making' || current.kind === 'failed') &&
          current.id === take.tootId
        ) {
          setPhase({ kind: 'idle' })
        }
      } else if (state === 'unused') {
        if (!canMake(take)) lose(take.tootId)
        else {
          const back = { tootId: take.tootId, done: true }
          const made = { played: take.performance, id: take.tootId, back }
          setPhase({ kind: 'making', ...made, plays: false, restored: false })
        }
        return
      }
    }
  })
  const isChecked = useRef(false)
  useEffect(() => {
    if (!libraryRead || !accountId || isChecked.current || !saveAsksForPayment()) return
    isChecked.current = true
    void recover(accountId)
  }, [libraryRead, accountId])

  const make = useEffectEvent((played: Performance, id: string) => pedos.makePadToot(played, id))
  const playOnce = useEffectEvent((draft: PadTootDraft) => {
    // Never while the page is hidden; and a page opened from a link or a reload can't start sound
    // before a tap.
    if (document.visibilityState === 'hidden') return
    if (navigator.userActivation?.hasBeenActive ?? true) pedos.toggleTootPlayback(draft)
  })
  const making = phase.kind === 'making' ? phase : null
  useEffect(() => {
    if (!making || !loaded) return
    let left = false
    make(making.played, making.id).then(
      draft => {
        if (left) return
        setPhase({ kind: 'ready', draft, back: making.back })
        if (making.plays) playOnce(draft)
      },
      error => {
        // "Couldn't make this Toot": reported by the error that caused it, such as a decode.
        reportError('toot-make-failed', error instanceof TootError ? (error.cause ?? error) : error)
        if (left) return
        if (making.restored && !saveAsksForPayment()) {
          // Shown again on the open where saving is free, it's let go rather than failing on every
          // open. Where it's paid it may be paid for, so it stays kept, to try again.
          forgetTake(making.id)
          setPhase({ kind: 'idle' })
        } else setPhase({ ...making, kind: 'failed' })
      }
    )
    return () => {
      left = true
    }
  }, [making, loaded])

  // Saved, the take isn't kept any more. Leaving the screen stops it and lets go of its audio.
  const { stopPlayback, forgetToot } = pedos
  const draft = phase.kind === 'ready' ? phase.draft : null
  const draftId = draft?.id ?? null
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
  const keep = (accountId: string) =>
    draft !== null && keepForCheckout(draft.id, draft.performance, accountId)

  return { phase, elapsed, record, stop, tapped, retry, keep }
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
    const lost = phase.kind === 'idle' && phase.lost === true
    return (
      <div className="flex flex-col gap-3">
        {lost && (
          <output className="block text-sm text-muted-foreground" data-testid="pad-take-lost">
            Your payment went through, but this take couldn't be made again here.{' '}
            <Link href="/support/" className="underline">
              Contact support
            </Link>{' '}
            for a refund.
          </output>
        )}
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
