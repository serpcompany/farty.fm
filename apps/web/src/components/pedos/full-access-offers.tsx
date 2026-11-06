'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState
} from 'react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { startAudioInTap } from '@/lib/audio/context'
import {
  type Checkout,
  hasStoredFullAccess,
  saveAsksForPayment,
  startOfferCheckout,
  waitForFullAccess
} from '@/lib/full-access'
import {
  clearOfferReturn,
  keepOfferNext,
  type OfferPlace,
  readOfferReturn,
  takeOfferNext,
  takeResultOffer
} from '@/lib/full-access-offers'
import { MAX_SAVED_TOOTS } from '@/lib/pricing'
import { reachStep } from '@/lib/telemetry/steps'
import { useAccount } from './account-provider'
import { FullAccessSheet } from './full-access-sheet'
import { PAY_PROBLEMS } from './pay-problems'
import { usePedos } from './pedos-provider'

/**
 * Welcome's button: `none`, it's hidden, as the account has Full Access or saving is free here;
 * `unsure`, there and not tappable, until Farty knows the account; `shows` once it does.
 */
export type WelcomeOffer = 'none' | 'unsure' | 'shows'

type OffersContext = {
  welcomeOffer: WelcomeOffer
  /** Welcome's button: a guest makes an account first, and then the sheet opens. */
  offerAtWelcome(): void
  /**
   * A Result's button, going to `href` through `then`. At the first Result, the account step for a
   * guest (`offerStep`), then the sheet for an account. Else just what `offerStep` does.
   */
  offerAtResult(href: string, then: () => void): void
}

const Context = createContext<OffersContext | null>(null)

export function useFullAccessOffers(): OffersContext {
  const context = useContext(Context)
  if (!context) throw new Error('useFullAccessOffers needs a FullAccessOffersProvider')
  return context
}

/** Where a Result's tap goes once the offer is over: a Result's, or none on Welcome. */
type Next = { href: string; then: () => void } | null

type Confirming = 'waiting' | 'paid' | 'notPaid' | 'signIn' | 'failed'

type FailedProblem = Extract<Checkout, { kind: 'failed' }>['problem']

/** The one thing an offer has on screen, so its sheets can never stack. */
type View =
  | { kind: 'offer'; place: OfferPlace; next: Next; busy: boolean }
  | { kind: 'confirm'; place: OfferPlace; next: Next; stage: Confirming; problem?: FailedProblem }

/**
 * The two offers of Full Access before Save (#407), on Welcome and at the first Result, and the
 * confirmation on the way back from Checkout. Each can be skipped. It holds the one sheet each shows,
 * after the account step and never over it, as the step's `then` only asks for the sheet: an effect
 * opens it, reading the account as it is by then, which also leaves #235's Home Screen step room
 * between the two.
 */
export function FullAccessOffersProvider({ children }: { children: ReactNode }) {
  const { account, offerStep, openStep, stepOpen } = useAccount()
  const { recordings, showsWelcome } = usePedos()
  const router = useRouter()
  const accountId = account.status === 'signedIn' ? account.id : null
  const [view, setView] = useState<View | null>(null)
  /** The account step closed, on the way to an offer. */
  const [afterStep, setAfterStep] = useState<{ place: OfferPlace; next: Next } | null>(null)
  /** What the server last said of an account's Full Access: null when it couldn't. */
  const [stored, setStored] = useState<{ id: string; active: boolean | null } | null>(null)
  /** A check is out for an offer's tap, so a second tap waits for its sheet. */
  const asking = useRef(false)

  const setStage = useCallback((stage: Confirming) => {
    setView(current => (current?.kind === 'confirm' ? { ...current, stage } : current))
  }, [])

  // Signed in on Welcome, its button goes if the account has it already.
  useEffect(() => {
    if (!showsWelcome || !accountId || !saveAsksForPayment()) return
    let current = true
    void hasStoredFullAccess(accountId).then(active => {
      if (current) setStored({ id: accountId, active })
    })
    return () => {
      current = false
    }
  }, [showsWelcome, accountId])

  const askThenOffer = useCallback(async (place: OfferPlace, next: Next, id: string) => {
    asking.current = true
    const active = await hasStoredFullAccess(id)
    asking.current = false
    if (active) {
      setStored({ id, active })
      // Welcome's tap asked for it, so it hears the answer. A Result's tap was going elsewhere.
      if (place === 'welcome') setView({ kind: 'confirm', place, next, stage: 'paid' })
      else next?.then()
      return
    }
    // Unsure at a Result: never hold up the tap. Welcome's tap asked for the sheet, and Pay's answer
    // decides.
    if (active === null && place === 'result') {
      next?.then()
      return
    }
    if (place === 'result') reachStep('offer-result-shown')
    setView({ kind: 'offer', place, next, busy: false })
  }, [])

  useEffect(() => {
    if (!afterStep) return
    setAfterStep(null)
    if (accountId) void askThenOffer(afterStep.place, afterStep.next, accountId)
    else afterStep.next?.then()
  }, [afterStep, accountId, askThenOffer])

  // Back from Checkout. Paid, the confirmation. Cancelled, it carries on where the tap was going.
  useEffect(() => {
    const back = readOfferReturn()
    if (!back) return
    if (back.done) {
      setView({ kind: 'confirm', place: back.place, next: null, stage: 'waiting' })
      return
    }
    clearOfferReturn()
    const href = takeOfferNext()
    if (back.place === 'result' && href) router.replace(href)
  }, [router])

  // The address keeps its query until the payment shows, so a reload checks again.
  const waiting = view?.kind === 'confirm' && view.stage === 'waiting'
  const settled = account.status !== 'checking'
  useEffect(() => {
    if (!waiting || !settled) return
    if (!accountId) {
      setStage('signIn')
      return
    }
    let current = true
    void waitForFullAccess(accountId).then(found => {
      if (!current) return
      if (found) {
        clearOfferReturn()
        setStored({ id: accountId, active: true })
      }
      setStage(found ? 'paid' : 'notPaid')
    })
    return () => {
      current = false
    }
  }, [waiting, settled, accountId, setStage])

  // Back from Checkout through the browser's history, the page can come back as it was left.
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return
      setView(current => (current?.kind === 'offer' ? { ...current, busy: false } : current))
    }
    window.addEventListener('pageshow', onShow)
    return () => window.removeEventListener('pageshow', onShow)
  }, [])

  const offerAtWelcome = () => {
    if (asking.current || view) return
    reachStep('offer-welcome-tapped')
    if (accountId) void askThenOffer('welcome', null, accountId)
    else openStep(() => setAfterStep({ place: 'welcome', next: null }), 'pay')
  }

  const offerAtResult = (href: string, then: () => void) => {
    if (asking.current || view) return
    const first =
      saveAsksForPayment() &&
      (account.status === 'signedIn' || account.status === 'signedOut') &&
      (recordings?.length ?? 0) <= 1 &&
      takeResultOffer()
    if (!first) {
      offerStep(then)
      return
    }
    offerStep(() => setAfterStep({ place: 'result', next: { href, then } }))
  }

  const pay = async () => {
    if (view?.kind !== 'offer' || view.busy || !accountId) return
    const { place, next } = view
    if (place === 'result') reachStep('offer-result-tapped')
    setView({ ...view, busy: true })
    const checkout = await startOfferCheckout(place, accountId)
    if (checkout.kind === 'pay') {
      if (next) keepOfferNext(next.href)
      window.location.assign(checkout.url)
    } else if (checkout.kind === 'active') {
      setStored({ id: accountId, active: true })
      setView({ kind: 'confirm', place, next, stage: 'paid' })
    } else {
      setView({ kind: 'confirm', place, next, stage: 'failed', problem: checkout.problem })
    }
  }

  const skipOffer = () => {
    if (view?.kind !== 'offer' || view.busy) return
    setView(null)
    view.next?.then()
  }

  const closeConfirmation = () => {
    if (view?.kind !== 'confirm') return
    clearOfferReturn()
    setView(null)
    if (view.next) {
      view.next.then()
      return
    }
    const href = view.place === 'result' ? takeOfferNext() : null
    if (!href) return
    // Song Creator plays the Toot once it's made: this tap starts the sound it needs.
    if (href.startsWith('/compose/')) startAudioInTap()
    router.push(href)
  }

  const knownActive = stored?.id === accountId ? stored?.active : null
  const welcomeOffer: WelcomeOffer =
    !saveAsksForPayment() || knownActive === true
      ? 'none'
      : !settled || (accountId !== null && stored?.id !== accountId)
        ? 'unsure'
        : 'shows'

  return (
    <Context value={{ welcomeOffer, offerAtWelcome, offerAtResult }}>
      {children}
      {/* The account step comes first: a sheet never opens over it. */}
      <FullAccessSheet
        open={view?.kind === 'offer' && !stepOpen}
        busy={view?.kind === 'offer' && view.busy}
        onPay={() => void pay()}
        onClose={skipOffer}
      />
      {view?.kind === 'confirm' && (
        <Confirmation
          open={!stepOpen}
          stage={view.stage}
          problem={view.problem}
          onAgain={() => setStage('waiting')}
          onSignIn={() => openStep(() => setStage('waiting'))}
          onClose={closeConfirmation}
        />
      )}
    </Context>
  )
}

/**
 * On the way back from Checkout: whether Full Access has started, as far as Farty can tell. Or, in
 * place of the offer's sheet, why its Pay couldn't start.
 */
function Confirmation({
  open,
  stage,
  problem,
  onAgain,
  onSignIn,
  onClose
}: {
  open: boolean
  stage: Confirming
  problem?: FailedProblem
  onAgain: () => void
  onSignIn: () => void
  onClose: () => void
}) {
  const title = {
    waiting: 'Confirming your payment',
    paid: 'You have Full Access',
    notPaid: "Your payment hasn't come through yet",
    signIn: 'Sign in to use Full Access',
    failed: 'Full Access'
  }[stage]
  return (
    <Sheet open={open} onOpenChange={next => !next && onClose()}>
      <SheetContent
        side="bottom"
        className="mx-auto max-w-md gap-0 rounded-t-2xl pb-[env(safe-area-inset-bottom)]"
        data-testid="full-access-confirmation"
        showCloseButton={false}
      >
        <SheetHeader className="px-5 pt-5 pb-2">
          <SheetTitle className="text-xl font-semibold">{title}</SheetTitle>
          <SheetDescription className="text-base" render={<div />}>
            {stage === 'waiting' && (
              <output className="flex items-center gap-2">
                <Spinner aria-hidden className="size-5" />
                This takes a moment.
              </output>
            )}
            {stage === 'paid' && (
              <>Save up to {MAX_SAVED_TOOTS} Toots, from Songs and the Sound Pad.</>
            )}
            {stage === 'notPaid' && (
              <>
                It can take a minute. If you were charged and it doesn't start,{' '}
                <Link href="/support/" className="underline">
                  contact support
                </Link>
                .
              </>
            )}
            {stage === 'signIn' && <>Sign in with the email you paid with.</>}
            {stage === 'failed' && problem && PAY_PROBLEMS[problem]}
          </SheetDescription>
        </SheetHeader>
        <SheetFooter className="mt-0 px-5 pt-3 pb-5">
          {stage === 'notPaid' && (
            <Button size="lg" className="h-12 w-full text-base" onClick={onAgain}>
              Check again
            </Button>
          )}
          {stage === 'signIn' && (
            <Button size="lg" className="h-12 w-full text-base" onClick={onSignIn}>
              Sign in
            </Button>
          )}
          <Button
            size="lg"
            variant={stage === 'paid' ? 'default' : 'ghost'}
            className="h-12 w-full text-base"
            onClick={onClose}
          >
            {stage === 'paid' ? 'OK' : 'Close'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
