'use client'

import { ChevronRight } from 'lucide-react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { type ReactNode, useState } from 'react'
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
import { setSharing, useSharing } from '@/lib/telemetry/sharing'
import { useAccount } from './account-provider'
import { InstallButton, useInstallRoute } from './install-button'
import { usePedos } from './pedos-provider'

/**
 * The Fixture Library loader, in internal builds only: `build:staging` sets
 * NEXT_PUBLIC_FIXTURE_LIBRARY, and `build:production` clears it, so the Production build carries
 * none of the loader (`scripts/fixture-library.ts check`).
 */
const FixtureLibrary =
  process.env.NEXT_PUBLIC_FIXTURE_LIBRARY === '1'
    ? dynamic(() => import('./fixture-library').then(m => m.FixtureLibrary), { ssr: false })
    : null

const header = 'px-4 pb-1.5 text-xs font-normal text-muted-foreground'
const list = 'divide-y overflow-hidden rounded-xl bg-muted/60'

/**
 * Profile: what you've collected and made, counted from what's in this browser, your account,
 * where the Songs come from, and the app version. As the iPhone app's `ProfileTab`, plus the
 * account (#155), Install, sharing error reports (#126) and the privacy and support
 * pages, which the web app needs.
 */
export function ProfileScreen({ version }: { version: string }) {
  const stats = usePedos().profileStats
  const installRoute = useInstallRoute()

  return (
    <div className="flex flex-1 flex-col px-4 pb-6">
      <h1 className="pt-4 pb-3 text-3xl font-bold tracking-tight">Profile</h1>

      <section aria-labelledby="profile-stats">
        <h2 id="profile-stats" className={header}>
          Stats
        </h2>
        {stats === null ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : (
          <>
            <ul className={list}>
              <Row label="Recordings" testId="stat-recordings">
                {stats.recordings}
              </Row>
              <Row label="Melodic Recordings" testId="stat-melodic">
                {stats.melodicRecordings}
              </Row>
              <Row label="Notes collected" testId="stat-notes">
                {stats.notesCollected}
              </Row>
              <Row label="Songs unlocked" testId="stat-songs">
                {stats.unlockedSongs} of {stats.songs}
              </Row>
              <Row label="Toots" testId="stat-toots">
                {stats.toots}
              </Row>
            </ul>
            {stats.recordings === 0 && (
              <p
                className="px-4 pt-1.5 text-xs text-muted-foreground"
                data-testid="profile-new-user"
              >
                Record your first fart on the Record tab. Collect notes to unlock Songs.
              </p>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="profile-account" className="pt-6">
        <h2 id="profile-account" className={header}>
          Account
        </h2>
        <AccountSection />
      </section>

      {FixtureLibrary && <FixtureLibrary />}

      {installRoute && (
        <section aria-labelledby="profile-install" className="pt-6">
          <h2 id="profile-install" className={header}>
            Install
          </h2>
          <div className="rounded-xl bg-muted/60 px-4 py-3">
            <InstallButton />
          </div>
        </section>
      )}

      <section aria-labelledby="profile-privacy" className="pt-6">
        <h2 id="profile-privacy" className={header}>
          Privacy
        </h2>
        <SharingSection />
      </section>

      <section aria-labelledby="profile-about" className="pt-6">
        <h2 id="profile-about" className={header}>
          About
        </h2>
        <ul className={list}>
          <li
            className="flex min-h-11 flex-col justify-center px-4 py-2.5"
            data-testid="songs-credit"
          >
            <span>Songs</span>
            <span className="text-sm text-muted-foreground">From public-domain scores in PDMX</span>
          </li>
          <Row label="Version" testId="app-version">
            {version}
          </Row>
          <LinkRow href="/privacy/">Privacy</LinkRow>
          <LinkRow href="/support/">Support</LinkRow>
        </ul>
      </section>
    </div>
  )
}

/** A label with its value on the right, as SwiftUI's `LabeledContent`. */
function Row({ label, testId, children }: { label: string; testId: string; children: ReactNode }) {
  return (
    <li
      className="flex min-h-11 items-center justify-between gap-4 px-4 py-2.5"
      data-testid={testId}
    >
      <span>{label}</span>
      <span className="text-muted-foreground tabular-nums">{children}</span>
    </li>
  )
}

/** A row that opens one of the web app's own pages. */
function LinkRow({ href, children }: { href: string; children: ReactNode }) {
  return (
    <li>
      <Link
        href={href}
        className="flex min-h-11 items-center justify-between gap-4 px-4 py-2.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        {children}
        <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
      </Link>
    </li>
  )
}

const row =
  'flex min-h-11 w-full items-center justify-between gap-4 px-4 py-2.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset disabled:opacity-50'

/**
 * Share anonymous error reports (#126): on by default, kept in this browser, and off means no
 * report is sent (`src/lib/telemetry/`). Global Privacy Control turns it off, so the switch
 * shows off and can't be turned on.
 */
function SharingSection() {
  const sharing = useSharing()
  return (
    <>
      <ul className={list}>
        <li>
          {/* The whole row toggles the switch, so it's a full-size target. */}
          <label htmlFor="share-telemetry" className={row}>
            Share anonymous error reports
            <Switch
              id="share-telemetry"
              checked={sharing === 'on' || sharing === null}
              disabled={sharing === null || sharing === 'gpc'}
              onCheckedChange={setSharing}
            />
          </label>
        </li>
      </ul>
      {sharing === 'gpc' && (
        <p className="px-4 pt-1.5 text-xs text-muted-foreground">
          Off, because your browser asks sites not to share your data (Global Privacy Control).
        </p>
      )}
    </>
  )
}

/**
 * Signed out: Save to an account, which opens the account step, and what a guest loses. Signed
 * in: the email, Farty news, Sign out and Delete account. A session that ended: Sign in again.
 */
function AccountSection() {
  const { account, openStep, retry, signOut, deleteAccount, setMarketingEmail, clearDevice } =
    useAccount()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [confirmsDelete, setConfirmsDelete] = useState(false)
  /** Some farts haven't reached the account: wait, or sign out anyway. */
  const [notUploaded, setNotUploaded] = useState(false)
  const [confirmsClear, setConfirmsClear] = useState(false)

  const [signingOut, setSigningOut] = useState(false)

  const signOutNow = async (anyway: boolean) => {
    setBusy(true)
    setSigningOut(true)
    setProblem(null)
    const result = await signOut(anyway)
    setBusy(false)
    setSigningOut(false)
    setNotUploaded(result === 'pending')
    if (result === 'failed') setProblem("Couldn't sign out. Check your connection and try again.")
  }

  /** Runs `action`, one at a time, and says `failure` if it fails. */
  const run = async (action: () => Promise<boolean>, failure: string) => {
    setBusy(true)
    setProblem(null)
    const done = await action()
    setBusy(false)
    if (!done) setProblem(failure)
    return done
  }

  if (account.status === 'checking') {
    return (
      <div className="flex justify-center py-3">
        <Spinner />
      </div>
    )
  }
  if (account.status === 'unreachable') {
    return (
      <ul className={list}>
        <li className="flex min-h-11 items-center justify-between gap-4 py-0 pl-4">
          <span className="text-muted-foreground">Can't reach your account right now.</span>
          <button
            type="button"
            className="min-h-11 shrink-0 px-4 font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
            onClick={retry}
          >
            Retry
          </button>
        </li>
      </ul>
    )
  }
  if (account.status === 'signedOut' || account.status === 'expired') {
    return (
      <>
        <ul className={list}>
          <li>
            <button type="button" className={row} onClick={openStep}>
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
            : 'Without an account, your Recordings stay only on this device, and your Toots are gone when you close Farty.'}
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
        <li>
          {/* The whole row toggles the switch, so it's a full-size target. */}
          <label htmlFor="pedos-news" className={row}>
            Farty news
            <Switch
              id="pedos-news"
              checked={account.marketingEmail}
              disabled={busy}
              onCheckedChange={on =>
                void run(() => setMarketingEmail(on), "Couldn't change Farty news. Try again.")
              }
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
          <button
            type="button"
            className={`${row} text-destructive`}
            disabled={busy}
            onClick={() => setConfirmsDelete(true)}
          >
            Delete account
          </button>
        </li>
      </ul>
      {problem && (
        <p role="alert" className="px-4 pt-1.5 text-xs text-destructive">
          {problem}
        </p>
      )}
      <AlertDialog open={confirmsDelete} onOpenChange={open => !busy && setConfirmsDelete(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes your email, Recordings and Toots from Farty, on every device. It can't be
              undone.
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
                const deleted = await run(
                  deleteAccount,
                  "Couldn't delete your account. Check your connection and try again."
                )
                if (!deleted) setConfirmsDelete(false)
              }}
            >
              {busy ? <Spinner /> : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={notUploaded} onOpenChange={open => !busy && setNotUploaded(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Not uploaded yet</AlertDialogTitle>
            <AlertDialogDescription>
              Some farts on this device haven't reached your account. Check your connection and
              wait, or sign out now and lose them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 text-base" disabled={busy}>
              Wait
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
