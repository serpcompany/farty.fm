'use client'

import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { stopPlayback } from '@/lib/audio/player'
import { libraryPulled, onLibraryPulled } from '@/lib/library-sync'
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
import type { PadTootDraft } from '@/lib/toot'
import {
  type CheckoutReturn,
  clearCheckoutReturn,
  readCheckoutReturn,
  saveAsksForPayment,
  tootPaymentState
} from '@/lib/toot-payment'
import { TootError } from '@/lib/toot-renderer'
import { useAccount } from './account-provider'
import { usePageHidden } from './page-hidden'
import { useRecordings } from './recordings-provider'
import { useToots } from './toots-provider'

type Take = {
  played: Performance
  id: string
  back: CheckoutReturn | null
  plays: boolean
  restored: boolean
}

type Phase =
  | { kind: 'idle'; lost?: boolean }
  | { kind: 'recording'; firstTapAt: number | null }
  | ({ kind: 'making' } & Take)
  | { kind: 'ready'; draft: PadTootDraft; back: CheckoutReturn | null }
  | ({ kind: 'failed' } & Take)

export type PadTake = {
  phase: Phase
  elapsed: number
  record(): void
  stop(): void
  tapped(at: number, recordingId: string): void
  retry(): void
  keep(accountId: string): boolean
}

function causeOf(error: unknown): unknown {
  return error instanceof TootError ? (error.cause ?? error) : error
}

function canPlayNow(): boolean {
  if (document.visibilityState === 'hidden') return false
  return navigator.userActivation?.hasBeenActive ?? true
}

function usePulledAccount(): string | null {
  const [pulled, setPulled] = useState(libraryPulled)
  useEffect(() => {
    const update = () => setPulled(libraryPulled())
    update()
    return onLibraryPulled(update)
  }, [])
  return pulled
}

export function usePadTake(): PadTake {
  const { recordings, recording, makePadToot } = useRecordings()
  const { toots, toot, toggleTootPlayback, forgetToot } = useToots()
  const { account } = useAccount()
  const accountId = account.status === 'signedIn' ? account.id : null
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [elapsed, setElapsed] = useState(0)
  const taps = useRef<Tap[] | null>(null)
  const loaded = recordings !== null
  const libraryRead = loaded && toots !== null
  const pulled = usePulledAccount()
  const mayArrive = accountId !== null && pulled !== accountId
  const recorded = useRef(false)
  const shown = useRef(phase)
  useEffect(() => {
    shown.current = phase
  }, [phase])

  const stopTake = (plays: boolean) => {
    if (taps.current === null) return
    const played = performanceOf(taps.current)
    taps.current = null
    if (!played) {
      setPhase({ kind: 'idle' })
      return
    }
    const id = crypto.randomUUID()
    keepTake(id, played)
    setPhase({ kind: 'making', played, id, back: null, plays, restored: false })
  }
  const stop = () => stopTake(true)
  const stopByItself = useEffectEvent(stopTake)

  const record = () => {
    stopPlayback()
    recorded.current = true
    taps.current = []
    setElapsed(0)
    setPhase({ kind: 'recording', firstTapAt: null })
  }

  const tapped = (at: number, recordingId: string) => {
    if (taps.current === null) return
    taps.current.push({ at: at / 1000, recordingId })
    setPhase(current =>
      current.kind === 'recording' && current.firstTapAt === null
        ? { kind: 'recording', firstTapAt: at }
        : current
    )
    if (taps.current.length >= MAX_TAPS) stop()
  }

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

  usePageHidden(() => stopTake(false))

  const canMake = (take: KeptTake) =>
    take.performance.recordings.every(id => recording(id) !== undefined)
  const awaiting = useRef<{ take: KeptTake; back: CheckoutReturn } | null>(null)
  const replaceable = () => {
    const current = shown.current
    if (recorded.current || awaiting.current) return false
    if (current.kind === 'idle') return !current.lost
    return current.kind !== 'recording' && current.back === null
  }
  const lose = (tootId: string) => {
    reportError('pad-paid-take-lost')
    forgetTake(tootId)
    setPhase({ kind: 'idle', lost: true })
  }
  const makeAgain = (take: KeptTake, back: CheckoutReturn) => {
    const made = { played: take.performance, id: take.tootId, back }
    setPhase({ kind: 'making', ...made, plays: false, restored: false })
  }
  const makePaid = (take: KeptTake, back: CheckoutReturn) => {
    if (canMake(take)) makeAgain(take, back)
    else if (mayArrive) awaiting.current = { take, back }
    else lose(take.tootId)
  }
  const makePaidNow = useEffectEvent(makePaid)
  const pulledNow = useEffectEvent(() => {
    const waiting = awaiting.current
    if (!waiting || mayArrive) return
    awaiting.current = null
    if (!recorded.current) makePaid(waiting.take, waiting.back)
  })
  useEffect(() => {
    if (pulled) pulledNow()
  }, [pulled])

  const openedFromCheckout = (back: CheckoutReturn): boolean => {
    const kept = keptTake(back.tootId)
    if (toot(back.tootId)) forgetTake(back.tootId)
    else if (kept && canMake(kept)) {
      makeAgain(kept, back)
      return true
    } else if (kept && back.done) {
      clearCheckoutReturn()
      makePaid(kept, back)
      return true
    } else if (back.done) {
      clearCheckoutReturn()
      lose(back.tootId)
      return true
    }
    clearCheckoutReturn()
    return false
  }
  const restoreKept = () => {
    let restored = false
    for (const take of keptTakes()) {
      if (toot(take.tootId)) forgetTake(take.tootId)
      else if (!canMake(take)) {
        if (!saveAsksForPayment()) forgetTake(take.tootId)
      } else if (!restored) {
        restored = true
        const { performance: played, tootId: id } = take
        setPhase({ kind: 'making', played, id, back: null, plays: false, restored: true })
      }
    }
  }
  const opened = useEffectEvent(() => {
    const back = readCheckoutReturn()
    if (back && openedFromCheckout(back)) return
    restoreKept()
  })
  const isOpen = useRef(false)
  useEffect(() => {
    if (!libraryRead || isOpen.current) return
    isOpen.current = true
    opened()
  }, [libraryRead])

  const letGoOfUsed = (tootId: string) => {
    forgetTake(tootId)
    const current = shown.current
    if (current.kind === 'ready' && current.draft.id === tootId) {
      stopPlayback()
      setPhase({ kind: 'idle' })
    } else if ((current.kind === 'making' || current.kind === 'failed') && current.id === tootId) {
      setPhase({ kind: 'idle' })
    }
  }
  const recover = useEffectEvent(async (accountId: string) => {
    for (const take of keptTakes()) {
      if (!replaceable()) return
      if (toot(take.tootId)) {
        forgetTake(take.tootId)
        continue
      }
      const state = await tootPaymentState(take.tootId, accountId)
      if (!replaceable()) return
      if (state === 'used') letGoOfUsed(take.tootId)
      else if (state === 'unused') {
        makePaidNow(take, { tootId: take.tootId, done: true })
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

  const make = useEffectEvent((played: Performance, id: string) => makePadToot(played, id))
  const playOnce = useEffectEvent((draft: PadTootDraft) => {
    if (canPlayNow()) toggleTootPlayback(draft)
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
        reportError('toot-make-failed', causeOf(error))
        if (left) return
        if (making.restored && !saveAsksForPayment()) {
          forgetTake(making.id)
          setPhase({ kind: 'idle' })
        } else setPhase({ ...making, kind: 'failed' })
      }
    )
    return () => {
      left = true
    }
  }, [making, loaded])

  const draft = phase.kind === 'ready' ? phase.draft : null
  const draftId = draft?.id ?? null
  const isSaved = draftId !== null && toot(draftId) !== undefined
  useEffect(() => {
    if (isSaved && draftId) forgetTake(draftId)
  }, [isSaved, draftId])
  useEffect(() => stopPlayback, [])
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
