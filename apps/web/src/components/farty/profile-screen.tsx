'use client'

import { ChevronRight } from 'lucide-react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { setSharing, useSharing } from '@/lib/telemetry/sharing'
import { AccountSection, row } from './account-section'
import { ProfileFriends } from './friends-section'
import { InstallGuideCard, useInstallGuide } from './install-button'
import { useRecordings } from './recordings-provider'
import { useSongCatalog } from './song-catalog-provider'
import { useToots } from './toots-provider'

const FixtureLibrary =
  process.env.NEXT_PUBLIC_FIXTURE_LIBRARY === '1'
    ? dynamic(() => import('./fixture-library').then(m => m.FixtureLibrary), { ssr: false })
    : null

const header = 'px-4 pb-1.5 text-xs font-normal text-muted-foreground'
const list = 'divide-y overflow-hidden rounded-xl bg-muted/60'

function useProfileStats() {
  const { recordings, melodicRecordings, collectedNotes, songRows } = useRecordings()
  const { toots } = useToots()
  const { songs } = useSongCatalog()
  if (recordings === null || toots === null || songs === null) return null
  return {
    recordings: recordings.length,
    melodicRecordings: melodicRecordings.length,
    notesCollected: collectedNotes.size,
    unlockedSongs: songRows.filter(row => row.coverage.unlocked).length,
    songs: songs.length,
    toots: toots.length
  }
}

export function ProfileScreen({ version }: { version: string }) {
  const stats = useProfileStats()
  const { songsFailed, reloadSongs } = useSongCatalog()

  return (
    <div className="flex flex-1 flex-col px-4 pb-6">
      <h1 className="pt-4 pb-3 text-3xl font-bold tracking-tight">Profile</h1>

      <section aria-labelledby="profile-stats">
        <h2 id="profile-stats" className={header}>
          Stats
        </h2>
        {stats === null && songsFailed ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-sm text-muted-foreground">Couldn't load the Songs.</p>
            <Button variant="outline" onClick={reloadSongs}>
              Try again
            </Button>
          </div>
        ) : stats === null ? (
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

      <ProfileFriends />

      <section aria-labelledby="profile-account" className="pt-6">
        <h2 id="profile-account" className={header}>
          Account
        </h2>
        <AccountSection />
      </section>

      {FixtureLibrary && <FixtureLibrary />}

      <section aria-labelledby="profile-install" className="pt-6">
        <h2 id="profile-install" className={header}>
          Get the app
        </h2>
        <InstallGuideCard />
        <SafariMicrophoneTip />
      </section>

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

function SafariMicrophoneTip() {
  if (useInstallGuide() !== 'share-sheet') return null
  return (
    <p className="px-4 pt-1.5 text-xs text-muted-foreground" data-testid="safari-microphone-tip">
      To stop Safari asking for the microphone, tap the Page Menu button at the left of the search
      field, then Website Settings, and set Microphone to Allow.
    </p>
  )
}

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

function SharingSection() {
  const sharing = useSharing()
  return (
    <>
      <ul className={list}>
        <li>
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
