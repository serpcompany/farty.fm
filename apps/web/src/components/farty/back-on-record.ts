'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { stopPlayback } from '@/lib/audio/player'
import { desktop } from '@/lib/desktop'
import type { Tab } from '@/lib/tabs'

export function useBackOnRecord(tab: Tab | null, staysPut: boolean): void {
  const router = useRouter()
  const wasHidden = useRef(false)
  const leftThePage = useRef(false)
  useEffect(() => {
    const visibilityChanged = () => {
      if (document.visibilityState === 'hidden') {
        wasHidden.current = true
        stopPlayback()
        return
      }
      if (!wasHidden.current) return
      wasHidden.current = false
      const cameBackFromAnotherPage = leftThePage.current
      leftThePage.current = false
      if (cameBackFromAnotherPage || staysPut || tab === null || tab === 'record') return
      if (!window.matchMedia(desktop).matches) router.push('/')
    }
    const pageHidden = () => {
      leftThePage.current = true
    }
    const pageShown = () => {
      wasHidden.current = false
      leftThePage.current = false
    }
    document.addEventListener('visibilitychange', visibilityChanged)
    window.addEventListener('pagehide', pageHidden)
    window.addEventListener('pageshow', pageShown)
    return () => {
      document.removeEventListener('visibilitychange', visibilityChanged)
      window.removeEventListener('pagehide', pageHidden)
      window.removeEventListener('pageshow', pageShown)
    }
  }, [router, staysPut, tab])
}
