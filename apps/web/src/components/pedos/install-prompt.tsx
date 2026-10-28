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
import { ShareSheetHint, useInstallRoute } from './install-button'
import { useRecordFlow } from './record-flow-provider'
import { useRecordings } from './recordings-provider'

const offeredKey = 'pedos.installOffered'

export function InstallPrompt() {
  const { recordings } = useRecordings()
  const { flow } = useRecordFlow()
  const route = useInstallRoute()
  const [open, setOpen] = useState(false)

  useEffect(registerServiceWorker, [])

  const hasRecording = (recordings?.length ?? 0) > 0
  useEffect(() => {
    if (hasRecording) void keepRecordings()
  }, [hasRecording])

  useEffect(
    () =>
      onRecordingSaved(() => {
        if (currentInstallRoute() === null) return
        try {
          if (localStorage.getItem(offeredKey) !== null) return
          localStorage.setItem(offeredKey, '1')
        } catch {
          return
        }
        setOpen(true)
      }),
    []
  )

  if (!open || route === null || flow) return null
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
