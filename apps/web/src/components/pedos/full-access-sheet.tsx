'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { FULL_ACCESS_PRICE_LABEL, MAX_SAVED_TOOTS, MONEY_BACK_DAYS } from '@/lib/pricing'

/**
 * What Save, or a saved Toot's Download, asks of an account without Full Access (ADR 0022): the
 * price, what it covers and the money-back line, with Pay and Not now. Pay stays busy while the page
 * goes to Checkout.
 */
export function FullAccessSheet({
  open,
  busy,
  onPay,
  onClose
}: {
  open: boolean
  busy: boolean
  onPay: () => void
  onClose: () => void
}) {
  return (
    <Sheet open={open} onOpenChange={next => !next && onClose()}>
      <SheetContent
        side="bottom"
        className="mx-auto max-w-md gap-0 rounded-t-2xl pb-[env(safe-area-inset-bottom)]"
        data-testid="full-access-sheet"
        showCloseButton={false}
      >
        <SheetHeader className="px-5 pt-5 pb-2">
          <SheetTitle className="text-xl font-semibold">Full Access</SheetTitle>
          <SheetDescription className="text-base">
            {FULL_ACCESS_PRICE_LABEL}, once. Save up to {MAX_SAVED_TOOTS} Toots, from Songs and the
            Sound Pad, and download them.
          </SheetDescription>
        </SheetHeader>
        <p className="px-5 pb-2 text-sm text-muted-foreground">
          Not happy?{' '}
          <Link href="/support/" className="underline">
            Get your money back
          </Link>{' '}
          within {MONEY_BACK_DAYS} days.
        </p>
        <SheetFooter className="mt-0 px-5 pt-3 pb-5">
          <Button size="lg" className="h-12 w-full text-base" disabled={busy} onClick={onPay}>
            {busy && <Spinner aria-hidden className="size-5" />}
            Pay {FULL_ACCESS_PRICE_LABEL}
          </Button>
          <Button
            size="lg"
            variant="ghost"
            className="h-12 w-full text-base"
            disabled={busy}
            onClick={onClose}
          >
            Not now
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
