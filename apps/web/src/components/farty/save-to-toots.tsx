'use client'

import { Check } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { readableLibraryOwner } from '@/lib/account'
import { TOOT_PRICE_LABEL } from '@/lib/pricing'
import { holdReload } from '@/lib/stale-build'
import { reportError } from '@/lib/telemetry/errors'
import type { TootDraft } from '@/lib/toot'
import {
  type CheckoutReturn,
  clearCheckoutReturn,
  paidReturnPath,
  saveAsksForPayment,
  startCheckout,
  waitUntilPaid
} from '@/lib/toot-payment'
import { useAccount } from './account-provider'
import { useToots } from './toots-provider'

const SAVE_PROBLEMS = {
  saveFailed: "Couldn't save this Toot.",
  unavailable: "Payments aren't available right now.",
  limitReached: "You've kept as many Toots as an account can. Delete one to save this one.",
  charged: (
    <>
      You were charged, but this Toot couldn't be saved.{' '}
      <Link href="/support/" className="underline">
        Contact support
      </Link>{' '}
      for a refund.
    </>
  ),
  tooMany: "You've started a lot of payments. Try again later.",
  failed: "Couldn't start the payment.",
  notPaidYet: "Your payment hasn't come through yet. Tap Save to check again.",
  notKept: "This take can't be saved in this browser: it can't keep the take while you pay.",
  unreachable: "Couldn't reach your account. Tap Save to try again."
}

const heldByAnAccount = () => typeof readableLibraryOwner() === 'string'

type Busy = 'saving' | 'paying' | 'confirming'

function saveLabel(isSaved: boolean, confirming: boolean, isPaid: boolean) {
  if (isSaved) {
    return (
      <>
        <Check className="size-5" />
        Saved to Toots
      </>
    )
  }
  if (confirming) {
    return (
      <>
        <Spinner className="size-5" />
        Confirming payment…
      </>
    )
  }
  return isPaid ? `Save to Toots · ${TOOT_PRICE_LABEL}` : 'Save to Toots'
}

function useBackFromCheckoutPage(onBack: () => void): void {
  const back = useEffectEvent(onBack)
  useEffect(() => {
    const shown = (event: PageTransitionEvent) => {
      if (event.persisted) back()
    }
    window.addEventListener('pageshow', shown)
    return () => window.removeEventListener('pageshow', shown)
  }, [])
}

export function SaveToToots({
  draft,
  back,
  keep: keepForCheckout
}: {
  draft: TootDraft
  back: CheckoutReturn | null
  keep?: (accountId: string) => boolean
}) {
  const { toot, saveToot } = useToots()
  const { account, stepOpen, openStep, retry } = useAccount()
  const accountId = account.status === 'signedIn' ? account.id : null
  const isPaid = saveAsksForPayment()
  const isSaved = toot(draft.id) !== undefined
  const returnedPaid = isPaid && back?.done === true && back.tootId === draft.id
  const [busy, setBusy] = useState<Busy | null>(null)
  const [problem, setProblem] = useState<keyof typeof SAVE_PROBLEMS | null>(null)
  const [savesAfterSignIn, setSavesAfterSignIn] = useState(false)
  const paying = useRef(false)
  useEffect(() => (isSaved ? undefined : holdReload()), [isSaved])

  const save = async (): Promise<boolean> => {
    setBusy('saving')
    setProblem(null)
    try {
      await saveToot(draft)
      return true
    } catch (error) {
      reportError('toot-save-failed', error)
      setProblem('saveFailed')
      return false
    } finally {
      setBusy(null)
    }
  }

  const pay = async (accountId: string) => {
    if (paying.current) return
    if (keepForCheckout && !keepForCheckout(accountId)) {
      setProblem('notKept')
      return
    }
    paying.current = true
    setBusy('paying')
    setProblem(null)
    const checkout = await startCheckout(draft.id, draft.song?.id ?? null, accountId)
    if (checkout.kind === 'pay') {
      window.location.assign(checkout.url)
      return
    }
    if (checkout.kind === 'paidToot' && draft.song) {
      window.location.replace(paidReturnPath(draft.song.id, checkout.tootId))
      return
    }
    paying.current = false
    setBusy(null)
    if (checkout.kind === 'paid') {
      if (await save()) clearCheckoutReturn()
    } else setProblem(checkout.kind === 'failed' ? checkout.problem : 'failed')
  }
  const keep = (accountId: string) => void (isPaid ? pay(accountId) : save())
  const keepAfterSignIn = useEffectEvent(keep)

  const tapSave = () => {
    if (accountId) keep(accountId)
    else if (account.status === 'signedOut' || account.status === 'expired') {
      setSavesAfterSignIn(true)
      openStep()
    } else if (account.status === 'unreachable' && !isPaid && heldByAnAccount()) {
      void save()
    } else if (account.status === 'unreachable') {
      setProblem(returnedPaid ? null : 'unreachable')
      retry()
    }
  }

  useEffect(() => {
    if (accountId) setProblem(current => (current === 'unreachable' ? null : current))
  }, [accountId])

  useEffect(() => {
    if (!savesAfterSignIn) return
    if (accountId) {
      setSavesAfterSignIn(false)
      keepAfterSignIn(accountId)
    } else if (!stepOpen) setSavesAfterSignIn(false)
  }, [savesAfterSignIn, accountId, stepOpen])

  useBackFromCheckoutPage(() => {
    paying.current = false
    setBusy(null)
  })

  const confirm = useEffectEvent(async (accountId: string) => {
    setBusy('confirming')
    const paid = await waitUntilPaid(draft.id, accountId)
    setBusy(null)
    if (!paid) setProblem('notPaidYet')
    else if (await save()) clearCheckoutReturn()
  })
  const readsAccount = account.status === 'checking'
  const waitsForAccount =
    returnedPaid && !isSaved && busy === null && problem === null && readsAccount
  const shownProblem =
    problem ??
    (returnedPaid && !isSaved && busy === null && account.status === 'unreachable'
      ? 'unreachable'
      : null)
  const confirming = useRef(false)
  useEffect(() => {
    if (!returnedPaid || !accountId || confirming.current) return
    confirming.current = true
    void confirm(accountId)
  }, [returnedPaid, accountId])
  useEffect(() => {
    if (back && !back.done) clearCheckoutReturn()
  }, [back])

  return (
    <div className="sticky bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] mt-auto md:bottom-0 bg-linear-to-t from-background from-70% to-transparent px-5 pt-5 pb-3">
      <Button
        className="h-12 w-full text-base"
        disabled={isSaved || busy !== null || readsAccount}
        onClick={tapSave}
      >
        {saveLabel(isSaved, busy === 'confirming' || waitsForAccount, isPaid)}
      </Button>
      {shownProblem && (
        <p className="pt-2 text-center text-sm text-muted-foreground">
          {SAVE_PROBLEMS[shownProblem]}
        </p>
      )}
    </div>
  )
}
