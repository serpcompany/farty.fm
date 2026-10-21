'use client'

import { ChevronRight } from 'lucide-react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Spinner } from '@/components/ui/spinner'
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
 * Profile: what you've collected and made, where the Songs come from, and the app version, all
 * counted from what's in this browser, with no account (ADR 0001). As the iPhone app's
 * `ProfileTab`, plus Install and the privacy and support pages, which the web app needs.
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
