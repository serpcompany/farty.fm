import { useSyncExternalStore } from 'react'
import { clearQueue } from './queue'

type Sharing = 'on' | 'off' | 'gpc'

const sharingKey = 'pedos.telemetry'

export function sharing(): Sharing {
  try {
    const gpc = (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl
    if (gpc === true) return 'gpc'
    return localStorage.getItem(sharingKey) === 'off' ? 'off' : 'on'
  } catch {
    return 'off'
  }
}

export function sharingAllowed(): boolean {
  return sharing() === 'on'
}

const listeners = new Set<() => void>()

export function setSharing(on: boolean): void {
  try {
    if (on) localStorage.removeItem(sharingKey)
    else localStorage.setItem(sharingKey, 'off')
  } catch {}
  if (!on) clearQueue()
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const fromOtherTab = (event: StorageEvent) => {
    if (event.key === sharingKey || event.key === null) listener()
  }
  window.addEventListener('storage', fromOtherTab)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', fromOtherTab)
  }
}

export function useSharing(): Sharing | null {
  return useSyncExternalStore(subscribe, sharing, () => null)
}
