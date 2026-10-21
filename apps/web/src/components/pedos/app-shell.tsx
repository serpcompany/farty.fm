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
import { usePathname, useRouter } from 'next/navigation'
import { type ReactNode, useEffect, useRef } from 'react'
import { type Tab, tabOf, tabs } from '@/lib/tabs'
import { cn } from '@/lib/utils'
import { useAccount } from './account-provider'
import { AccountStep } from './account-step'
import { desktop, Lander } from './lander'
import { usePedos } from './pedos-provider'
import { useTrackPages } from './previous-page'
import { RecordFlow } from './record-flow'
import { Welcome } from './welcome'

/**
 * The iPhone app's tab symbols: waveform, music.note, record.circle, music.note.list and
 * person.crop.circle.
 */
const icons: Record<Tab, LucideIcon> = {
  recordings: AudioLines,
  compose: Music2,
  record: CircleDot,
  toots: ListMusic,
  profile: CircleUserRound
}

/**
 * The five tabs, as the iPhone app's `AppTabs`. Playback stops on a tab change and while the page
 * is hidden. The page comes back on Record, unless Recording, Review, Result or the account step is
 * open.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pedos = usePedos()
  const { stopPlayback, showsRecordFlow, finishWelcome, flow, capture } = pedos
  // Reading the sign-in code in another app hides the page: the step stays where it was.
  const { stepOpen } = useAccount()
  const pathname = usePathname()
  const router = useRouter()
  const tab = tabOf(pathname)
  // While Recording, Review, Result (`record-flow.tsx`) or the account step shows, but not while
  // the microphone is still opening, when the Record screen and its tabs are still there.
  const stepsOpen =
    stepOpen || flow !== null || capture.kind === 'recording' || capture.kind === 'finishing'
  // From 768px, `/` is the lander until Farty is opened in this browser (`lander.tsx`).
  const atLander = pathname === '/'
  useTrackPages()

  // From 768px, any other tab's URL, such as a Song's link, opens the app and counts as opened.
  // Phones keep Welcome, which asks for the microphone, on every tab.
  useEffect(() => {
    if (tab === null || atLander || document.documentElement.hasAttribute('data-welcomed')) return
    if (window.matchMedia(desktop).matches) finishWelcome()
  }, [tab, atLander, finishWelcome])

  // Moving within a tab, such as to a Song on Compose, isn't a tab change.
  const shownTab = useRef(tab)
  useEffect(() => {
    if (shownTab.current === tab) return
    shownTab.current = tab
    stopPlayback()
  }, [tab, stopPlayback])

  const wasHidden = useRef(false)
  useEffect(() => {
    const visibilityChanged = () => {
      if (document.visibilityState === 'hidden') {
        wasHidden.current = true
        stopPlayback()
      } else if (wasHidden.current) {
        wasHidden.current = false
        // Pages outside the tabs stay where they are.
        if (!showsRecordFlow && !stepOpen && tab !== null && tab !== 'record') router.push('/')
      }
    }
    document.addEventListener('visibilitychange', visibilityChanged)
    return () => document.removeEventListener('visibilitychange', visibilityChanged)
  }, [router, showsRecordFlow, stepOpen, stopPlayback, tab])

  return (
    <>
      {/* From 768px, a browser that hasn't opened the app gets the lander at `/` instead of
          Welcome. Every other page is always the page itself. */}
      {atLander && <Lander />}
      {/* From 768px the tab bar is a top bar with the name, and the page is a wider column. */}
      <div
        className={cn(
          'flex min-h-dvh flex-col overflow-x-clip md:pt-16',
          atLander && 'md:unwelcomed:hidden'
        )}
      >
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col pt-[env(safe-area-inset-top)] pb-20 md:max-w-2xl md:pt-6 md:pb-12">
          {pedos.waitsForOtherTabs && (
            <output className="block px-4 pt-4 text-center text-muted-foreground">
              Close Farty in your other tabs to carry on.
            </output>
          )}
          {children}
        </main>
        <nav
          aria-label="Tabs"
          // Recording, Review, Result and the account step leave the top bar in view from 768px,
          // but, as on a phone, the tabs wait until they close.
          inert={stepsOpen}
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
                // A small static PNG; Workers has no image optimizer configured.
                unoptimized
                className="rounded-lg"
              />
              Farty
            </Link>
            <ul
              className={cn(
                'mx-auto flex max-w-md md:mx-0 md:max-w-none md:gap-1',
                stepsOpen && 'md:opacity-50'
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
        {/* Only on the tabs, so the privacy, support and 404 pages are always readable. */}
        {pedos.showsWelcome && tab !== null && <Welcome />}
      </div>
    </>
  )
}
