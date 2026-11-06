'use client'

import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { wide } from '@/lib/desktop'
import {
  hasFullAccess,
  saveAsksForPayment,
  startOfferCheckout,
  waitForFullAccess
} from '@/lib/full-access'
import {
  clearOfferReturn,
  markOfferSeen,
  notePaymentPending,
  type OfferPlace,
  offerWasSeen,
  paymentPending,
  readOfferReturn
} from '@/lib/full-access-offers'
import { FULL_ACCESS_PRICE_LABEL } from '@/lib/pricing'
import { reachStep } from '@/lib/telemetry/steps'
import { cn } from '@/lib/utils'
import { useAccount } from './account-provider'
import { FullAccessSheet } from './full-access-sheet'
import { PAYMENT_PROBLEMS } from './payment-problems'
import { usePedos } from './pedos-provider'
import { NotePill } from './share-recording'

// The two offers of Full Access before Save (#407, ADR 0022): a button on Welcome, and the first
// Result. Each opens Save's sheet, can always be skipped, and gets one go in a browser. Pay comes back
// to the page it left, where `FullAccessReturn` confirms it.

const STEPS = {
  welcome: { shown: 'offer-welcome-shown', tapped: 'offer-welcome-tapped' },
  result: { shown: 'offer-result-shown', tapped: 'offer-result-tapped' }
} as const

const UNREACHABLE = "Couldn't reach Farty. Check your connection and try again."
const HAS_IT = 'You already have Full Access.'
const NOT_PAID_YET = "Your payment hasn't come through yet. Farty will check again when you save."
/** A note lasts this long, unless there's something left to do about it. */
const NOTE_MS = 5_000
const NOT_PAID_YET_MS = 10_000
/** A tap doesn't wait longer than this to know whether to offer: nothing is offered without it. */
const CHECK_MS = 5_000
/** Over Welcome, a note sits at the top, clear of its buttons. */
const NOTE_ON_TOP = 'top-[max(1rem,env(safe-area-inset-top))] bottom-auto'

function answerInTime(accountId: string): Promise<boolean | null> {
  return Promise.race([
    hasFullAccess(accountId),
    new Promise<null>(done => setTimeout(() => done(null), CHECK_MS))
  ])
}

/** Where an offer's Pay comes back to, and what carries on when there's nothing to pay or it's skipped. */
type CarryOn = { page: string; next: () => void }

/**
 * One place's offer: `offer` uses up the place's go, then opens the sheet for an account without Full
 * Access, or else carries on. Never for a guest, as `pay` needs an account. With no answer from the
 * server or a payment on its way, nothing is offered, as Save and Download: a new Checkout could charge
 * twice. Render `dialogs`, with the sheet and the note.
 */
function useFullAccessOffer(
  place: OfferPlace,
  { headline, noteClassName }: { headline?: string; noteClassName?: string } = {}
) {
  const { account } = useAccount()
  const accountId = account.status === 'signedIn' ? account.id : null
  /** An offer to decide on, from the next render, as the account step's sign-in has reached it. */
  const [opening, setOpening] = useState<CarryOn | null>(null)
  const [checking, setChecking] = useState(false)
  const [sheet, setSheet] = useState<CarryOn | null>(null)
  const [paying, setPaying] = useState(false)
  const [note, setNote] = useState<ReactNode>(null)
  /** A second tap, before the first one's answer, starts nothing. */
  const running = useRef(false)

  useEffect(() => {
    if (typeof note !== 'string') return
    const timer = setTimeout(() => setNote(null), NOTE_MS)
    return () => clearTimeout(timer)
  }, [note])

  // Back to this page from Checkout's with the browser's Back, Pay can be tapped again.
  useEffect(() => {
    const shown = (event: PageTransitionEvent) => {
      if (!event.persisted) return
      running.current = false
      setPaying(false)
    }
    window.addEventListener('pageshow', shown)
    return () => window.removeEventListener('pageshow', shown)
  }, [])

  const decide = useEffectEvent(async (carryOn: CarryOn) => {
    setNote(null)
    markOfferSeen(place)
    if (!accountId || paymentPending(accountId)) {
      carryOn.next()
      return
    }
    setChecking(true)
    const active = await answerInTime(accountId)
    setChecking(false)
    if (active === false) {
      reachStep(STEPS[place].shown)
      setSheet(carryOn)
      return
    }
    setNote(active ? HAS_IT : UNREACHABLE)
    carryOn.next()
  })
  useEffect(() => {
    if (!opening) return
    setOpening(null)
    void decide(opening)
  }, [opening])

  const pay = async () => {
    if (running.current || !sheet) return
    if (!accountId) {
      setSheet(null)
      setNote(UNREACHABLE)
      return
    }
    running.current = true
    setPaying(true)
    reachStep(STEPS[place].tapped)
    const checkout = await startOfferCheckout(sheet.page, accountId)
    if (checkout.kind === 'pay') {
      // Off to Checkout: Pay stays busy while the page goes.
      window.location.assign(checkout.url)
      return
    }
    running.current = false
    setPaying(false)
    setSheet(null)
    if (checkout.kind === 'active') {
      setNote(HAS_IT)
      sheet.next()
    } else if (checkout.problem === 'limitReached') setNote(PAYMENT_PROBLEMS.failed)
    else setNote(PAYMENT_PROBLEMS[checkout.problem])
  }

  const skip = () => {
    if (running.current) return
    setSheet(null)
    sheet?.next()
  }

  return {
    offer: setOpening,
    checking,
    dialogs: (
      <>
        <FullAccessSheet
          open={sheet !== null}
          busy={paying}
          email={account.status === 'signedIn' ? account.email : null}
          headline={headline}
          onPay={() => void pay()}
          onClose={skip}
        />
        {note && <NotePill className={noteClassName}>{note}</NotePill>}
      </>
    )
  }
}

/**
 * Welcome's offer: a quiet button, and what it opens. A guest makes an account first, as for Save and
 * Download, so Pay always has an account to pay for. Not now, there or on the sheet, is back to Welcome
 * with the button gone for good. An account with Full Access, or whose answer doesn't come, sees no
 * button, which holds its place until it's known. A phone only, as Welcome is.
 */
export function useWelcomeOffer(): { button: ReactNode; dialogs: ReactNode } {
  const { account, openStep } = useAccount()
  const accountId = account.status === 'signedIn' ? account.id : null
  const guest = account.status === 'signedOut' || account.status === 'expired'
  // Welcome only appears once this browser's storage has been read, so this never meets the server's.
  const [done, setDone] = useState(
    () => !saveAsksForPayment() || offerWasSeen('welcome') || readOfferReturn()
  )
  const [access, setAccess] = useState<boolean | null>()
  const { offer, checking, dialogs } = useFullAccessOffer('welcome', {
    headline: 'Keep every Toot you make.',
    noteClassName: NOTE_ON_TOP
  })

  useEffect(() => {
    if (done || !accountId || window.matchMedia(wide).matches) return
    if (paymentPending(accountId)) {
      setAccess(null)
      return
    }
    let current = true
    void answerInTime(accountId).then(active => {
      if (current) setAccess(active)
    })
    return () => {
      current = false
    }
  }, [done, accountId])

  const tap = () => {
    const carryOn = { page: window.location.pathname, next: () => setDone(true) }
    if (accountId) offer(carryOn)
    else openStep(() => offer(carryOn), 'fullAccess')
  }

  const offering = guest || (accountId !== null && access === false)
  const holding = account.status === 'checking' || (accountId !== null && access === undefined)
  return {
    button:
      !done && (offering || holding) ? (
        <Button
          size="lg"
          variant="outline"
          className={cn('h-12 w-full text-base', !offering && 'invisible')}
          disabled={checking}
          onClick={tap}
        >
          {checking && <Spinner aria-hidden className="size-5" />}
          Get Full Access for {FULL_ACCESS_PRICE_LABEL}
        </Button>
      ) : null,
    dialogs
  }
}

/**
 * The first Result's offer, with its account step, one after the other so two sheets never stack: its
 * buttons lead through the step, for a guest it still offers to, then the sheet, then where they were
 * going. The first tap uses it up, whatever comes of it. A browser's first Result is the one that
 * leaves it with a single Recording, so a reload, or a library that came with an account, offers nothing.
 */
export function useFirstResultOffer(finish: (href: string) => void) {
  const pedos = usePedos()
  const { offerStep } = useAccount()
  const [due] = useState(
    () => saveAsksForPayment() && !offerWasSeen('result') && pedos.recordings?.length === 1
  )
  const used = useRef(false)
  const { offer, checking, dialogs } = useFullAccessOffer('result')

  const go = (href: string) => {
    if (checking) return
    const next = () => finish(href)
    if (!due || used.current) {
      offerStep(next)
      return
    }
    used.current = true
    offerStep(() => offer({ page: href, next }))
  }

  return { go, checking, dialogs }
}

/**
 * Back from Checkout with `?offer=done`, on whichever page the offer left: says it's confirming, and
 * then that it's paid. Until it's paid the address keeps the return, so a reload checks again, and
 * `paymentPending` stops anything offering Pay. Signed out, its step opens, once: a payment needs an
 * account to reach, and Not now leaves it for the next sign-in. The sale's email is the server's.
 */
export function FullAccessReturn() {
  const { showsWelcome } = usePedos()
  const { account, stepOpen, openStep } = useAccount()
  const accountId = account.status === 'signedIn' ? account.id : null
  const [stage, setStage] = useState<'waiting' | 'paid' | 'notPaid' | null>(null)
  const askedForAccount = useRef(false)
  const waited = useRef(false)

  useEffect(() => {
    if (saveAsksForPayment() && readOfferReturn()) setStage('waiting')
  }, [])

  const wait = useEffectEvent(async (accountId: string) => {
    notePaymentPending(accountId)
    if ((await waitForFullAccess(accountId)) === null) {
      setStage('notPaid')
      return
    }
    clearOfferReturn()
    setStage('paid')
  })
  useEffect(() => {
    if (stage !== 'waiting' || !accountId || waited.current) return
    waited.current = true
    void wait(accountId)
  }, [stage, accountId])

  const askForAccount = useEffectEvent(() => openStep())
  const signedOut = account.status === 'signedOut' || account.status === 'expired'
  useEffect(() => {
    if (stage !== 'waiting' || !signedOut) return
    if (!askedForAccount.current) {
      askedForAccount.current = true
      askForAccount()
    } else if (!stepOpen) {
      clearOfferReturn()
      setStage(null)
    }
  }, [stage, signedOut, stepOpen])

  useEffect(() => {
    if (stage !== 'paid' && stage !== 'notPaid') return
    const timer = setTimeout(() => setStage(null), stage === 'paid' ? NOTE_MS : NOT_PAID_YET_MS)
    return () => clearTimeout(timer)
  }, [stage])

  const note =
    stage === 'paid'
      ? 'Payment confirmed. You have Full Access.'
      : stage === 'notPaid'
        ? NOT_PAID_YET
        : stage !== 'waiting'
          ? null
          : account.status === 'unreachable'
            ? UNREACHABLE
            : accountId || account.status === 'checking'
              ? 'Confirming payment…'
              : null
  return note ? (
    <NotePill className={showsWelcome ? NOTE_ON_TOP : undefined}>{note}</NotePill>
  ) : null
}
