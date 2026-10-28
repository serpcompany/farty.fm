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
  type AccountChange,
  clearStepDraft,
  readSession,
  readStepDraft,
  stopStepOffers,
  takeSignInAgain,
  takeStepOffer
} from '@/lib/account'
import { keepRecordings } from '@/lib/install'
import { forgetLibrary, startSync, uploadBeforeSignOut } from '@/lib/library-sync'
import { openVisit } from '@/lib/visit'

type SignOut = 'signedOut' | 'pending' | 'failed'

type AccountContext = {
  account: Account
  stepOpen: boolean
  offerStep(then?: () => void): void
  openStep(): void
  retry(): void
  skipStep(): void
  finishSignIn(account: Account): void
  signOut(anyway?: boolean): Promise<SignOut>
  deleteAccount(): Promise<AccountChange>
  setMarketingEmail(on: boolean): Promise<boolean>
  clearDevice(): Promise<void>
}

const Context = createContext<AccountContext | null>(null)

export function useAccount(): AccountContext {
  const context = useContext(Context)
  if (!context) throw new Error('useAccount needs an AccountProvider')
  return context
}

async function leave(): Promise<void> {
  await forgetLibrary()
  window.location.replace('/profile/')
}

function reopenAsSignedIn(): void {
  window.location.reload()
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account>({ status: 'checking' })
  const [stepOpen, setStepOpen] = useState(false)
  const then = useRef<(() => void) | null>(null)

  useEffect(() => {
    let current = true
    openVisit().account.then(read => {
      if (!current) return
      setAccount(read)
      if (read.status === 'signedIn') return
      if (readStepDraft() || (read.status === 'expired' && takeSignInAgain())) setStepOpen(true)
    })
    return () => {
      current = false
    }
  }, [])

  const accountId = account.status === 'signedIn' ? account.id : null
  const accountEmail = account.status === 'signedIn' ? account.email : ''
  useEffect(() => {
    if (accountId) return startSync(accountId, accountEmail, openVisit().library)
  }, [accountId, accountEmail])

  const retry = useCallback(() => {
    setAccount({ status: 'checking' })
    void readSession().then(setAccount)
  }, [])

  useEffect(() => {
    if (account.status !== 'unreachable') return
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [account.status, retry])

  const show = useCallback((next: (() => void) | null) => {
    clearStepDraft()
    then.current = next
    setStepOpen(true)
  }, [])

  const offerStep = useCallback(
    (next?: () => void) => {
      if (account.status === 'signedOut' && takeStepOffer()) show(next ?? null)
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

  const deleteAccount = useCallback(async (): Promise<AccountChange> => {
    if (!accountId) return 'failed'
    const result = await api.deleteAccount(accountId)
    if (result === 'otherAccount') reopenAsSignedIn()
    else if (result === 'done') await leave()
    return result
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
