'use client'

import {
  AudioLines,
  CircleDot,
  CircleUserRound,
  ListMusic,
  type LucideIcon,
  Music2
} from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { type ReactNode, useEffect, useRef } from 'react'
import { type Tab, tabOf, tabs } from '@/lib/tabs'
import { cn } from '@/lib/utils'
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
 * is hidden. The page comes back on Record, unless Recording, Review or Result is open.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pedos = usePedos()
  const { stopPlayback, showsRecordFlow } = pedos
  const pathname = usePathname()
  const router = useRouter()
  const tab = tabOf(pathname)
  useTrackPages()

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
        if (!showsRecordFlow && tab !== null && tab !== 'record') router.push('/')
      }
    }
    document.addEventListener('visibilitychange', visibilityChanged)
    return () => document.removeEventListener('visibilitychange', visibilityChanged)
  }, [router, showsRecordFlow, stopPlayback, tab])

  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col pt-[env(safe-area-inset-top)] pb-20">
        {pedos.waitsForOtherTabs && (
          <output className="block px-4 pt-4 text-center text-muted-foreground">
            Close Pedos in your other tabs to carry on.
          </output>
        )}
        {children}
      </main>
      <nav
        aria-label="Tabs"
        className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
      >
        <ul className="mx-auto flex max-w-md">
          {tabs.map(({ id, href, label }) => {
            const current = id === tab
            const Icon = icons[id]
            return (
              <li key={id} className="flex-1">
                <Link
                  href={href}
                  aria-current={current ? 'page' : undefined}
                  className={cn(
                    'flex h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                    current ? 'text-foreground' : 'text-muted-foreground'
                  )}
                >
                  <Icon className="size-6" aria-hidden />
                  {label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
      <RecordFlow />
      {/* Only on the tabs, so the privacy, support and 404 pages are always readable. */}
      {pedos.showsWelcome && tab !== null && <Welcome />}
    </div>
  )
}
