'use client'

import { useEffect, useEffectEvent } from 'react'

export function usePageHidden(onHidden: () => void): void {
  const hidden = useEffectEvent(onHidden)
  useEffect(() => {
    const visibilityChanged = () => {
      if (document.visibilityState === 'hidden') hidden()
    }
    document.addEventListener('visibilitychange', visibilityChanged)
    return () => document.removeEventListener('visibilitychange', visibilityChanged)
  }, [])
}
