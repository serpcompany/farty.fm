'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

let shown: string | null = null
let previous: string | null = null

/** Notes each page the app shows, so a screen can tell which page opened it. In `AppShell`. */
export function useTrackPages(): void {
  const pathname = usePathname()
  useEffect(() => {
    if (pathname === shown) return
    previous = shown
    shown = pathname
  }, [pathname])
}

/** The page shown before this one since the page loaded, or null after a direct load or reload. */
export function previousPage(): string | null {
  return previous
}
