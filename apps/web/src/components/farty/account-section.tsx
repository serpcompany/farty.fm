'use client'

import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { type NotUploaded, useAccount } from './account-provider'
import { DeleteAccount } from './delete-account'
import { useShares } from './share-recording'
import { UnreachableRow } from './unreachable-row'

const list = 'divide-y overflow-hidden rounded-xl bg-muted/60'

export const row =
  'flex min-h-11 w-full items-center justify-between gap-4 px-4 py-2.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset disabled:opacity-50'

function notUploadedWords({ full, waiting }: NotUploaded) {
  if (waiting > 0) {
    const fullToo = full === 0 ? '' : `, and ${full} more can't because it's full`
    return {
      title: 'Not uploaded yet',
      text: `Some farts on this device haven't reached your account${fullToo}. Check your connection and wait, or sign out now and lose them.`,
      keep: 'Wait'
    }
  }
  const one = full === 1
  const farts = one ? "1 fart on this device isn't" : `${full} farts on this device aren't`
  return {
    title: 'Your account is full',
    text: `${farts} in your account because it's full. Delete some older ones to make room, or sign out now and lose ${one ? 'it' : 'them'}.`,
    keep: one ? 'Keep it' : 'Keep them'
  }
}

export function AccountSection() {
  const { account, openStep, retry, signOut, setMarketingEmail, clearDevice } = useAccount()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [notUploaded, setNotUploaded] = useState(false)
  const [left, setLeft] = useState<NotUploaded>({ full: 0, waiting: 0 })
  const [confirmsClear, setConfirmsClear] = useState(false)
  const handle = useShares()?.handle ?? null

  const [signingOut, setSigningOut] = useState(false)

  const signOutNow = async (anyway: boolean) => {
    setBusy(true)
    setSigningOut(true)
    setProblem(null)
    const result = await signOut(anyway)
    setBusy(false)
    setSigningOut(false)
    const pending = typeof result === 'object'
    if (pending) setLeft(result)
    setNotUploaded(pending)
    if (result === 'failed') setProblem("Couldn't sign out. Check your connection and try again.")
  }

  const changeNews = async (on: boolean) => {
    setBusy(true)
    setProblem(null)
    const done = await setMarketingEmail(on)
    setBusy(false)
    if (!done) setProblem("Couldn't change Farty news. Try again.")
  }

  const unsent = notUploadedWords(left)

  if (account.status === 'checking') {
    return (
      <div className="flex justify-center py-3">
        <Spinner />
      </div>
    )
  }
  if (account.status === 'unreachable') {
    return <UnreachableRow what="your account" onRetry={retry} />
  }
  if (account.status === 'signedOut' || account.status === 'expired') {
    return (
      <>
        <ul className={list}>
          <li>
            <button type="button" className={row} onClick={() => openStep()}>
              {account.status === 'expired' ? 'Sign in again' : 'Save to an account'}
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
            </button>
          </li>
          {account.status === 'expired' && (
            <li>
              <button
                type="button"
                className={`${row} text-destructive`}
                onClick={() => setConfirmsClear(true)}
              >
                Clear this device
              </button>
            </li>
          )}
        </ul>
        <p className="px-4 pt-1.5 text-xs text-muted-foreground">
          {account.status === 'expired'
            ? 'Your session ended. Your farts stay on this device until you sign in.'
            : 'Your farts are gone when you close Farty, unless you make a free account.'}
        </p>
        <AlertDialog open={confirmsClear} onOpenChange={open => !busy && setConfirmsClear(open)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear this device?</AlertDialogTitle>
              <AlertDialogDescription>
                This deletes the Recordings and Toots on this device. The ones saved to your account
                stay there.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="h-11 text-base" disabled={busy}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                className="h-11 text-base"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  await clearDevice()
                }}
              >
                {busy ? <Spinner /> : 'Clear'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    )
  }

  return (
    <>
      <ul className={list}>
        <li className="flex min-h-11 items-center justify-between gap-4 px-4 py-2.5">
          <span>Email</span>
          <span className="min-w-0 truncate text-muted-foreground" data-testid="account-email">
            {account.email}
          </span>
        </li>
        {handle && (
          <li>
            <Link
              href={`/u/${handle}/`}
              className="flex min-h-11 items-center justify-between gap-4 px-4 py-2.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
            >
              <span className="shrink-0">Your page</span>
              <span className="flex min-w-0 items-center gap-1">
                <span
                  className="min-w-0 truncate text-muted-foreground"
                  data-testid="account-handle"
                >
                  @{handle}
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </span>
            </Link>
          </li>
        )}
        <li>
          <label htmlFor="farty-news" className={row}>
            Farty news
            <Switch
              id="farty-news"
              checked={account.marketingEmail}
              disabled={busy}
              onCheckedChange={on => void changeNews(on)}
            />
          </label>
        </li>
        <li>
          <button
            type="button"
            className={row}
            disabled={busy}
            onClick={() => void signOutNow(false)}
          >
            Sign out
            {signingOut && !notUploaded && <Spinner />}
          </button>
        </li>
        <li>
          <DeleteAccount
            className={`${row} text-destructive`}
            disabled={busy}
            onFailed={() =>
              setProblem("Couldn't delete your account. Check your connection and try again.")
            }
          />
        </li>
      </ul>
      {problem && (
        <p role="alert" className="px-4 pt-1.5 text-xs text-destructive">
          {problem}
        </p>
      )}
      <AlertDialog open={notUploaded} onOpenChange={open => !busy && setNotUploaded(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{unsent.title}</AlertDialogTitle>
            <AlertDialogDescription>{unsent.text}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 text-base" disabled={busy}>
              {unsent.keep}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              className="h-11 text-base"
              disabled={busy}
              onClick={() => void signOutNow(true)}
            >
              {busy ? <Spinner /> : 'Sign out anyway'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
