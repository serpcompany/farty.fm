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
import {
  type Account,
  clearStepDraft,
  readSession,
  readStepDraft,
  type StepMoment,
  stopStepOffers,
  takeSignInAgain,
  takeStepOffer
} from '@/lib/account'
import { keepRecordings } from '@/lib/install'
import { forgetLibrary, startSync, uploadBeforeSignOut } from '@/lib/library-sync'
import { openVisit } from '@/lib/visit'

/**
 * How a Sign out went: signed out; not yet, since some farts haven't reached the account (Profile
 * asks whether to wait or sign out anyway); or Farty couldn't be reached.
 */
export type SignOut = 'signedOut' | 'pending' | 'failed'

type AccountContext = {
  account: Account
  /** The account step is on screen, over everything. */
  stepOpen: boolean
  /**
   * At a Result's button, or after a saved Toot: shows the account step first when it's due, then
   * `then`, which goes where the person tapped. Signed in, or once it's been offered, just `then`.
   */
  offerStep(moment: StepMoment, then?: () => void): void
  /** Profile's Save to an account, or Sign in again. */
  openStep(): void
  /** Reads the session again, as Profile's Retry. It never clears anything. */
  retry(): void
  /** Not now: closes the step and carries on. */
  skipStep(): void
  /** The step signed in: closes it and carries on. */
  finishSignIn(account: Account): void
  /**
   * Uploads what this browser hasn't yet, then signs out and clears this browser's copy. With
   * `anyway`, signs out without waiting for the upload, and what didn't upload is lost.
   */
  signOut(anyway?: boolean): Promise<SignOut>
  /**
   * Deletes the account, then this browser's copy. False when it didn't. When the session is
   * another account's now (a sign-in in another tab), deletes nothing and reloads as that account.
   */
  deleteAccount(): Promise<boolean>
  /**
   * Turns Farty news by email on or off. False when it didn't change. When the session is another
   * account's now, changes nothing and reloads as that account.
   */
  setMarketingEmail(on: boolean): Promise<boolean>
  /**
   * After a session ended: clears this browser's copy, for a device that's no longer the
   * account's. What reached the account stays there.
   */
  clearDevice(): Promise<void>
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
  await forgetLibrary()
  window.location.replace('/profile/')
}

/**
 * The session is another account's now (a sign-in in another tab): this page reloads as that
 * account, which reads the session and claims the library, and nothing is deleted or changed.
 */
function reopenAsSignedIn(): void {
  window.location.reload()
}

/** The account of whoever uses Farty here, and the account step (#155). */
export function AccountProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account>({ status: 'checking' })
  const [stepOpen, setStepOpen] = useState(false)
  /** Where the tap that opened the step goes once it closes. */
  const then = useRef<(() => void) | null>(null)

  useEffect(() => {
    let current = true
    openVisit().account.then(read => {
      if (!current) return
      setAccount(read)
      if (read.status === 'signedIn') return
      // A reload while the step was open (a phone dropping the tab during Mail) comes back to it,
      // and a browser whose session ended is asked to sign in again, once a visit.
      if (readStepDraft() || (read.status === 'expired' && takeSignInAgain())) setStepOpen(true)
    })
    return () => {
      current = false
    }
  }, [])

  // Signed in, this browser's library keeps in step with the account's (#156).
  const accountId = account.status === 'signedIn' ? account.id : null
  const accountEmail = account.status === 'signedIn' ? account.email : ''
  useEffect(() => {
    if (accountId) return startSync(accountId, accountEmail, openVisit().library)
  }, [accountId, accountEmail])

  const retry = useCallback(() => {
    setAccount({ status: 'checking' })
    void readSession().then(setAccount)
  }, [])

  // Back online, an account that couldn't be read is read again.
  useEffect(() => {
    if (account.status !== 'unreachable') return
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [account.status, retry])

  /** Opens the step afresh, at the email. */
  const show = useCallback((next: (() => void) | null) => {
    clearStepDraft()
    then.current = next
    setStepOpen(true)
  }, [])

  const offerStep = useCallback(
    (moment: StepMoment, next?: () => void) => {
      if (account.status === 'signedOut' && takeStepOffer(moment)) show(next ?? null)
      else next?.()
    },
    [account.status, show]
  )

  const close = useCallback(() => {
    clearStepDraft()
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

  const signOut = useCallback(
    async (anyway = false): Promise<SignOut> => {
      if (!anyway && accountId) {
        const left = await uploadBeforeSignOut(accountId).catch(() => 1)
        if (left > 0) return 'pending'
      }
      if (!(await api.signOut())) return 'failed'
      await leave()
      return 'signedOut'
    },
    [accountId]
  )

  const deleteAccount = useCallback(async () => {
    if (!accountId) return false
    const result = await api.deleteAccount(accountId)
    if (result === 'otherAccount') reopenAsSignedIn()
    else if (result === 'done') await leave()
    return result !== 'failed'
  }, [accountId])

  const setMarketingEmail = useCallback(
    async (on: boolean) => {
      if (!accountId) return false
      const result = await api.setMarketingEmail(on, accountId)
      if (result === 'otherAccount') reopenAsSignedIn()
      else if (result === 'done') {
        setAccount(current =>
          current.status === 'signedIn' ? { ...current, marketingEmail: on } : current
        )
      }
      return result !== 'failed'
    },
    [accountId]
  )

  const value: AccountContext = {
    account,
    stepOpen,
    offerStep,
    openStep: () => show(null),
    retry,
    skipStep: close,
    finishSignIn,
    signOut,
    deleteAccount,
    setMarketingEmail,
    clearDevice: leave
  }
  return <Context value={value}>{children}</Context>
}
