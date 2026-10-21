import { useSyncExternalStore } from 'react'
import { clearQueue } from './queue'

/**
 * Whether this browser shares error reports (#126): Profile's "Share anonymous error reports", on
 * by default and kept on the device. Off, no error report is sent. Global Privacy Control turns it
 * off too, whatever the switch says. (The key predates the switch's new label; it stays, so people
 * who turned it off stay off.)
 *
 * - `on`: sending.
 * - `off`: the switch is off.
 * - `gpc`: the browser sends Global Privacy Control.
 */
export type Sharing = 'on' | 'off' | 'gpc'

/** localStorage: `off` once the switch is turned off. Absent means on. */
export const sharingKey = 'pedos.telemetry'

export function sharing(): Sharing {
  try {
    const gpc = (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl
    if (gpc === true) return 'gpc'
    return localStorage.getItem(sharingKey) === 'off' ? 'off' : 'on'
  } catch {
    // No storage to read the switch from: send nothing.
    return 'off'
  }
}

export function sharingAllowed(): boolean {
  return sharing() === 'on'
}

const listeners = new Set<() => void>()

/** Turns sharing on or off. Off also drops the reports waiting to be sent. */
export function setSharing(on: boolean): void {
  try {
    if (on) localStorage.removeItem(sharingKey)
    else localStorage.setItem(sharingKey, 'off')
  } catch {
    // The switch can't be kept; GPC and the default still apply.
  }
  if (!on) clearQueue()
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // Another tab's switch.
  const fromOtherTab = (event: StorageEvent) => {
    if (event.key === sharingKey || event.key === null) listener()
  }
  window.addEventListener('storage', fromOtherTab)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', fromOtherTab)
  }
}

/** `sharing()`, kept current; null while the page is prerendered or hydrating. */
export function useSharing(): Sharing | null {
  return useSyncExternalStore(subscribe, sharing, () => null)
}
