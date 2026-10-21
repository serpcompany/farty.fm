'use client'

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState
} from 'react'
import * as api from '@/lib/account'
import { type Account, type StepMoment, stopStepOffers, takeStepOffer } from '@/lib/account'
import { keepRecordings } from '@/lib/install'
import { clearLibrary } from '@/lib/recording-store'
import { openVisit } from '@/lib/visit'

type AccountContext = {
  account: Account
  /** The account step is on screen, over everything. */
  stepOpen: boolean
  /**
   * At a Result's button, or after a saved Toot: shows the account step first when it's due, then
   * `then`, which goes where the person tapped. Signed in, or once it's been offered, just `then`.
   */
  offerStep(moment: StepMoment, then?: () => void): void
  /** Profile's Save to an account. */
  openStep(): void
  /** Not now: closes the step and carries on. */
  skipStep(): void
  /** The step signed in: closes it and carries on. */
  finishSignIn(account: Account): void
  /** Signs out and clears this browser's copy. False when Pedos couldn't be reached. */
  signOut(): Promise<boolean>
  /** Deletes the account, then this browser's copy. False when it didn't. */
  deleteAccount(): Promise<boolean>
  /** Turns Pedos news by email on or off. False when it didn't change. */
  setMarketingEmail(on: boolean): Promise<boolean>
}

const Context = createContext<AccountContext | null>(null)

export function useAccount(): AccountContext {
  const context = useContext(Context)
  if (!context) throw new Error('useAccount needs an AccountProvider')
  return context
}

/**
 * Leaves a signed-out browser with nothing: the library goes, and Profile opens afresh, so no
 * screen keeps the Recordings and Toots it showed.
 */
async function leave(): Promise<void> {
  // #156 waits for the outbox to upload here first (the plan's §2).
  await clearLibrary().catch(() => {})
  window.location.replace('/profile/')
}

/** The account of whoever uses Pedos here, and the account step (#155). */
export function AccountProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account>({ status: 'checking' })
  const [stepOpen, setStepOpen] = useState(false)
  /** Where the tap that opened the step goes once it closes. */
  const then = useRef<(() => void) | null>(null)

  useEffect(() => {
    let current = true
    openVisit().account.then(read => {
      if (current) setAccount(read)
    })
    return () => {
      current = false
    }
  }, [])

  const offerStep = useCallback(
    (moment: StepMoment, next?: () => void) => {
      if (account.status === 'signedOut' && takeStepOffer(moment)) {
        then.current = next ?? null
        setStepOpen(true)
      } else next?.()
    },
    [account.status]
  )

  const close = useCallback(() => {
    setStepOpen(false)
    const next = then.current
    then.current = null
    next?.()
  }, [])

  const finishSignIn = useCallback(
    (signedIn: Account) => {
      setAccount(signedIn)
      stopStepOffers()
      // Signed in, this browser's copy is kept, so the browser is asked to keep it too.
      void keepRecordings()
      close()
    },
    [close]
  )

  const signOut = useCallback(async () => {
    if (!(await api.signOut())) return false
    await leave()
    return true
  }, [])

  const deleteAccount = useCallback(async () => {
    if (!(await api.deleteAccount())) return false
    await leave()
    return true
  }, [])

  const setMarketingEmail = useCallback(async (on: boolean) => {
    const changed = await api.setMarketingEmail(on)
    if (changed) {
      setAccount(current =>
        current.status === 'signedIn' ? { ...current, marketingEmail: on } : current
      )
    }
    return changed
  }, [])

  const value: AccountContext = {
    account,
    stepOpen,
    offerStep,
    openStep: () => {
      then.current = null
      setStepOpen(true)
    },
    skipStep: close,
    finishSignIn,
    signOut,
    deleteAccount,
    setMarketingEmail
  }
  return <Context value={value}>{children}</Context>
}
