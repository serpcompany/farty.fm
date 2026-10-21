'use client'

import { Share } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import {
  currentInstallRoute,
  type InstallRoute,
  promptInstall,
  subscribeToInstall
} from '@/lib/install'

/** How this browser can install Pedos now, or null when it's installed or can't be. */
export function useInstallRoute(): InstallRoute | null {
  return useSyncExternalStore(subscribeToInstall, currentInstallRoute, () => null)
}

/**
 * Installs Pedos: Chrome's Install app button on Android, or how to add Pedos to the Home Screen
 * on iPhone. Renders nothing once Pedos is installed, or where the browser can't install it.
 */
export function InstallButton() {
  const route = useInstallRoute()
  if (route === 'prompt') {
    return (
      <Button className="h-11 px-5 text-base" onClick={() => void promptInstall()}>
        Install app
      </Button>
    )
  }
  if (route === 'share-sheet') return <ShareSheetHint />
  return null
}

/** Safari has no install prompt, so this says where to find Add to Home Screen. */
export function ShareSheetHint() {
  return (
    <p className="text-sm text-muted-foreground">
      Tap <Share className="inline size-4 -translate-y-px align-text-bottom" aria-hidden /> Share,
      then Add to Home Screen
    </p>
  )
}
