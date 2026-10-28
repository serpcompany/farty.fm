'use client'

import {
  AudioLines,
  CircleDot,
  CircleUserRound,
  ListMusic,
  type LucideIcon,
  Music2
} from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter, useSelectedLayoutSegments } from 'next/navigation'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { stopPlayback } from '@/lib/audio/player'
import { desktop, wide } from '@/lib/desktop'
import { onWaitingForOtherTabs } from '@/lib/recording-store'
import { type Tab, tabOf, tabs } from '@/lib/tabs'
import { cn } from '@/lib/utils'
import { useAccount } from './account-provider'
import { AccountStep } from './account-step'
import { appMain, Lander } from './lander'
import { LibraryProblemScreen } from './library-problem-screen'
import { useTrackPages } from './previous-page'
import { RecordFlow } from './record-flow'
import { useRecordFlow } from './record-flow-provider'
import { useRecordings } from './recordings-provider'
import { Welcome } from './welcome'
import { useWelcome } from './welcome-provider'

const icons: Record<Tab, LucideIcon> = {
  recordings: AudioLines,
  compose: Music2,
  record: CircleDot,
  toots: ListMusic,
  profile: CircleUserRound
}

function isTouchTablet(): boolean {
  return window.matchMedia(wide).matches && !window.matchMedia(desktop).matches
}

function useWaitsForOtherTabs(): boolean {
  const [waits, setWaits] = useState(false)
  useEffect(() => onWaitingForOtherTabs(setWaits), [])
  return waits
}

function useStopPlaybackOnTabChange(tab: Tab | null): void {
  const shownTab = useRef(tab)
  useEffect(() => {
    if (shownTab.current === tab) return
    shownTab.current = tab
    stopPlayback()
  }, [tab])
}

function useBackOnRecord(tab: Tab | null, staysPut: boolean): void {
  const router = useRouter()
  const wasHidden = useRef(false)
  useEffect(() => {
    const visibilityChanged = () => {
      if (document.visibilityState === 'hidden') {
        wasHidden.current = true
        stopPlayback()
      } else if (wasHidden.current) {
        wasHidden.current = false
        if (staysPut || tab === null || tab === 'record') return
        if (!window.matchMedia(desktop).matches) router.push('/')
      }
    }
    document.addEventListener('visibilitychange', visibilityChanged)
    return () => document.removeEventListener('visibilitychange', visibilityChanged)
  }, [router, staysPut, tab])
}

export function AppShell({ children, qrCode }: { children: ReactNode; qrCode: ReactNode }) {
  const { showsWelcome, finishWelcome } = useWelcome()
  const { showsRecordFlow, flow, capture } = useRecordFlow()
  const { stepOpen } = useAccount()
  const { libraryProblem } = useRecordings()
  const waitsForOtherTabs = useWaitsForOtherTabs()
  const segments = useSelectedLayoutSegments()
  const tab = tabOf(segments)
  const tabsCovered =
    stepOpen || flow !== null || capture.kind === 'recording' || capture.kind === 'finishing'
  const atHome = segments.length === 0
  useTrackPages()
  useStopPlaybackOnTabChange(tab)
  useBackOnRecord(tab, showsRecordFlow || stepOpen)

  useEffect(() => {
    if (tab === null || atHome || document.documentElement.hasAttribute('data-welcomed')) return
    if (isTouchTablet()) finishWelcome()
  }, [tab, atHome, finishWelcome])

  return (
    <>
      {tab !== null && <Lander atHome={atHome} qrCode={qrCode} />}
      <div
        className={cn(
          'flex min-h-dvh flex-col overflow-x-clip md:pt-16',
          atHome && 'md:unwelcomed:hidden',
          tab !== null && 'desktop:hidden'
        )}
      >
        <main
          id={appMain}
          tabIndex={-1}
          className="mx-auto flex w-full max-w-md flex-1 flex-col pt-[env(safe-area-inset-top)] pb-20 outline-none md:max-w-2xl md:pt-6 md:pb-12"
        >
          {waitsForOtherTabs && (
            <output className="block px-4 pt-4 text-center text-muted-foreground">
              Close Farty in your other tabs to carry on.
            </output>
          )}
          {libraryProblem ? <LibraryProblemScreen problem={libraryProblem} /> : children}
        </main>
        <nav
          aria-label="Tabs"
          inert={tabsCovered}
          className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:top-0 md:bottom-auto md:border-t-0 md:border-b"
        >
          <div className="contents md:mx-auto md:flex md:h-16 md:max-w-5xl md:items-center md:justify-between md:px-6">
            <Link
              href="/"
              className="hidden rounded-md text-lg font-bold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:flex md:h-11 md:items-center md:gap-2.5"
            >
              <Image
                src="/icons/icon-192.png"
                alt=""
                width={32}
                height={32}
                unoptimized
                className="rounded-lg"
              />
              Farty
            </Link>
            <ul
              className={cn(
                'mx-auto flex max-w-md md:mx-0 md:max-w-none md:gap-1 desktop:hidden',
                tabsCovered && 'md:opacity-50'
              )}
            >
              {tabs.map(({ id, href, label }) => {
                const current = id === tab
                const Icon = icons[id]
                return (
                  <li key={id} className="flex-1 md:flex-none">
                    <Link
                      href={href}
                      aria-current={current ? 'page' : undefined}
                      className={cn(
                        'flex h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:h-11 md:flex-row md:gap-2 md:rounded-md md:px-3 md:text-sm',
                        current ? 'text-foreground md:bg-muted' : 'text-muted-foreground'
                      )}
                    >
                      <Icon className="size-6 md:size-5" aria-hidden />
                      {label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        </nav>
        <RecordFlow />
        <AccountStep />
        {showsWelcome && tab !== null && <Welcome />}
      </div>
    </>
  )
}
