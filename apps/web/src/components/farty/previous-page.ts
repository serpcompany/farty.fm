'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

let shown: string | null = null
let previous: string | null = null

export function useTrackPages(): void {
  const pathname = usePathname()
  useEffect(() => {
    if (pathname === shown) return
    previous = shown
    shown = pathname
  }, [pathname])
}

const withoutTrailingSlash = (path: string) => path.replace(/\/$/, '')

export function cameFrom(path: string): boolean {
  return previous !== null && withoutTrailingSlash(previous) === withoutTrailingSlash(path)
}
