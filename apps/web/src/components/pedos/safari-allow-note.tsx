'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { shouldTellOfSafariAllow } from '@/lib/safari-allow'
import { useAccount } from './account-provider'
import { usePedos } from './pedos-provider'

/**
 * Tells an iPhone user whose microphone grant the browser forgets how to set Safari's Microphone
 * to Allow, once, on Compose, where no take is going on (#374).
 */
export function SafariAllowNote() {
  const { flow, capture, reviewOpen, showsWelcome } = usePedos()
  const { stepOpen } = useAccount()
  const [open, setOpen] = useState(false)
  const calm = flow === null && capture.kind === 'idle' && !reviewOpen && !showsWelcome && !stepOpen

  useEffect(() => {
    if (calm && shouldTellOfSafariAllow()) setOpen(true)
  }, [calm])

  // The page comes back on the Record tab, so the sheet doesn't stay open.
  useEffect(() => {
    const visibilityChanged = () => {
      if (document.visibilityState === 'hidden') setOpen(false)
    }
    document.addEventListener('visibilitychange', visibilityChanged)
    return () => document.removeEventListener('visibilitychange', visibilityChanged)
  }, [])

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
            Get louder sound and no microphone question each time. In your iPhone’s Settings, go to:
          </p>
          <p className="font-medium">Apps → Safari → Microphone → Allow</p>
          <p className="text-sm text-muted-foreground">
            This lets every website use your microphone without asking.
          </p>
        </div>
        <div className="px-6 pb-4">
          <SheetClose render={<Button className="h-11 w-full" />}>Got it</SheetClose>
        </div>
      </SheetContent>
    </Sheet>
  )
}
