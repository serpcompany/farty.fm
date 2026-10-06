'use client'

import { AudioLines, CircleDot } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { usePedos } from './pedos-provider'
import { RecordFlow } from './record-flow'
import { Welcome } from './welcome'

/**
 * The tabs, as on the iPhone: Recordings · Record for now. Compose, Toots and Profile join as
 * their slices land (#96, #98), in the iPhone app's order with Record in the center.
 */
const tabs = [
  { href: '/recordings/', label: 'Recordings', icon: AudioLines },
  { href: '/', label: 'Record', icon: CircleDot }
]

export function AppShell({ children }: { children: ReactNode }) {
  const pedos = usePedos()
  const pathname = usePathname()

  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col pt-[env(safe-area-inset-top)] pb-20">
        {children}
      </main>
      <nav
        aria-label="Tabs"
        className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
      >
        <ul className="mx-auto flex max-w-md">
          {tabs.map(({ href, label, icon: Icon }) => {
            const current = pathname === href || pathname === href.replace(/\/$/, '')
            return (
              <li key={href} className="flex-1">
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
      {pedos.showsWelcome && <Welcome />}
    </div>
  )
}
