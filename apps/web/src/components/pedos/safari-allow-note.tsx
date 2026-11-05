'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { SafariAllowRoute } from '@/lib/install'
import { safariAllowRouteToTell } from '@/lib/safari-allow'
import { useAccount } from './account-provider'
import { usePedos } from './pedos-provider'

const steps: Record<SafariAllowRoute, { where: string; path: string; note?: string }> = {
  // Apple's path, as Profile's tip says it.
  'page-menu': {
    where: 'Tap the Page Menu button at the left of the search field, then:',
    path: 'Website Settings → Microphone → Allow'
  },
  // Stopped the question on the owner's phone on 2026-10-28.
  settings: {
    where: 'In your iPhone’s Settings, go to:',
    path: 'Apps → Safari → Microphone → Allow',
    note: 'This lets every website use your microphone without asking.'
  }
}

/**
 * Tells an iPhone user whose microphone grant the browser forgets how to set Safari's Microphone
 * to Allow, once, on Compose, where no take is going on (#374).
 */
export function SafariAllowNote() {
  const { flow, capture, reviewOpen, showsWelcome } = usePedos()
  const { stepOpen } = useAccount()
  const [route, setRoute] = useState<SafariAllowRoute | null>(null)
  const [open, setOpen] = useState(false)
  const calm = flow === null && capture.kind === 'idle' && !reviewOpen && !showsWelcome && !stepOpen

  useEffect(() => {
    if (!calm) return
    const toTell = safariAllowRouteToTell()
    if (toTell === null) return
    setRoute(toTell)
    setOpen(true)
  }, [calm])

  // The page comes back on the Record tab, so the sheet doesn't stay open.
  useEffect(() => {
    const visibilityChanged = () => {
      if (document.visibilityState === 'hidden') setOpen(false)
    }
    document.addEventListener('visibilitychange', visibilityChanged)
    return () => document.removeEventListener('visibilitychange', visibilityChanged)
  }, [])

  const shown = route && steps[route]
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="mx-auto w-full max-w-md gap-0 rounded-t-2xl pb-[env(safe-area-inset-bottom)]"
      >
        <SheetHeader className="items-center px-6 pt-5 pb-2">
          <SheetTitle className="text-center font-semibold">Make Farty louder</SheetTitle>
        </SheetHeader>
        <div className="space-y-3 px-6 pb-4 text-center">
          <p className="text-muted-foreground">
            Get louder sound and no microphone question each time. {shown?.where}
          </p>
          <p className="font-medium">{shown?.path}</p>
          {shown?.note && <p className="text-sm text-muted-foreground">{shown.note}</p>}
        </div>
        <div className="px-6 pb-4">
          <SheetClose render={<Button className="h-11 w-full" />}>Got it</SheetClose>
        </div>
      </SheetContent>
    </Sheet>
  )
}
