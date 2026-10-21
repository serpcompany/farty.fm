'use client'

import { useEffect } from 'react'
import { sharingAllowed, useSharing } from './sharing'

/** The beacon's script, as Cloudflare's snippet loads it. */
export const BEACON_SRC = 'https://static.cloudflareinsights.com/beacon.min.js'

/**
 * Cloudflare Web Analytics' beacon (`analytics.ts`), loaded only while sharing is on: never with
 * the switch off or Global Privacy Control. The layout renders this in Production only.
 */
export function AnalyticsBeacon({ token }: { token: string }) {
  const shared = useSharing()
  useEffect(() => {
    // Read again here, not from the first render's value: a page prerendered "on" may be off.
    if (shared !== null && sharingAllowed()) startBeacon(token)
    else if (shared !== null) stopBeacon()
  }, [shared, token])
  return null
}

function beaconScript(): HTMLScriptElement | null {
  return document.querySelector(`script[src="${BEACON_SRC}"]`)
}

function startBeacon(token: string): void {
  if (beaconScript()) return
  const script = document.createElement('script')
  script.defer = true
  script.src = BEACON_SRC
  script.setAttribute('data-cf-beacon', JSON.stringify({ token }))
  document.head.appendChild(script)
}

/**
 * Turned off while the beacon runs: its script goes, and so does `window.__cfBeacon`, its settings,
 * which the beacon checks before each send. That check is the beacon's own, not a documented
 * switch, so the next page load is when it's sure to stop.
 */
function stopBeacon(): void {
  beaconScript()?.remove()
  delete (window as Window & { __cfBeacon?: unknown }).__cfBeacon
}
