'use client'

import { X } from 'lucide-react'
import Image from 'next/image'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  currentInstallRoute,
  keepRecordings,
  promptInstall,
  registerServiceWorker
} from '@/lib/install'
import { onRecordingSaved } from '@/lib/recording-store'
import { useAccount } from './account-provider'
import { ShareSheetHint, useInstallRoute } from './install-button'
import { usePedos } from './pedos-provider'

const offeredKey = 'pedos.installOffered'

/**
 * Offers to install Farty once, after the first saved Recording, above the tabs. It hides when
 * it's closed or Farty is installed, and never shows on a computer, which has no app (#199). It
 * also registers the service worker and, signed in with a Recording, asks the browser to keep
 * Farty's storage. A guest's farts last only the visit, so a guest's browser isn't asked (#237).
 */
export function InstallPrompt() {
  const pedos = usePedos()
  const { account } = useAccount()
  const route = useInstallRoute()
  const [open, setOpen] = useState(false)

  useEffect(registerServiceWorker, [])

  const keeps = account.status === 'signedIn' && (pedos.recordings?.length ?? 0) > 0
  useEffect(() => {
    if (keeps) void keepRecordings()
  }, [keeps])

  useEffect(
    () =>
      onRecordingSaved(() => {
        if (currentInstallRoute() === null) return
        try {
          if (localStorage.getItem(offeredKey) !== null) return
          localStorage.setItem(offeredKey, '1')
        } catch {
          // Storage is blocked, so Farty can't remember the offer. It doesn't offer at all.
          return
        }
        setOpen(true)
      }),
    []
  )

  // It waits for the record flow to close, so it never covers the new Recording's note.
  if (!open || route === null || pedos.flow) return null
  return (
    <aside
      aria-label="Install Farty"
      className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 mx-auto w-full max-w-md px-3 md:bottom-4 desktop:hidden"
    >
      <div className="flex items-center gap-3 rounded-2xl border bg-card p-3 text-card-foreground shadow-lg">
        <Image
          src="/icons/icon-192.png"
          alt=""
          width={44}
          height={44}
          // A small static PNG; Workers has no image optimizer configured.
          unoptimized
          className="rounded-[10px]"
        />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Install Farty</p>
          {route === 'share-sheet' && <ShareSheetHint />}
        </div>
        {route === 'prompt' && <Button onClick={() => void promptInstall()}>Install app</Button>}
        <Button variant="ghost" size="icon" aria-label="Close" onClick={() => setOpen(false)}>
          <X />
        </Button>
      </div>
    </aside>
  )
}
