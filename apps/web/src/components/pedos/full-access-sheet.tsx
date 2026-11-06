'use client'

import { Check } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { FULL_ACCESS_PRICE_LABEL, MAX_SAVED_TOOTS, MONEY_BACK_DAYS } from '@/lib/pricing'

const BENEFITS = [
  `Save up to ${MAX_SAVED_TOOTS} Toots, from Songs and the Sound Pad`,
  'Send any saved Toot by link. Anyone can play it, no account needed',
  "They're in your account, in any browser you sign in to"
]

/**
 * What Save asks of an account without Full Access (ADR 0022): what it gets, the price, the money
 * back and who's buying, with Pay and Not now, on one phone screen with the Toot still in view above
 * it. Pay stays busy while the page goes to Checkout.
 *
 * `email` is the account's, which Checkout is given. A guest makes an account before this opens, so
 * it's theirs by then. Without one, as when the session ended while this was open, the line is left
 * out.
 */
export function FullAccessSheet({
  open,
  busy,
  email,
  onPay,
  onClose
}: {
  open: boolean
  busy: boolean
  email: string | null
  onPay: () => void
  onClose: () => void
}) {
  return (
    <Sheet open={open} onOpenChange={next => !next && onClose()}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-dvh max-w-md gap-0 overflow-y-auto rounded-t-2xl px-5 pt-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        data-testid="full-access-sheet"
        showCloseButton={false}
      >
        <SheetTitle className="text-2xl leading-tight font-bold tracking-tight">
          Keep this Toot, and every one after it.
        </SheetTitle>
        <SheetDescription
          render={<ul />}
          className="mt-2 flex flex-col gap-1 text-sm leading-snug text-foreground"
        >
          {BENEFITS.map(benefit => (
            <li key={benefit} className="flex gap-2">
              <Check aria-hidden className="mt-0.5 size-4 shrink-0" />
              {benefit}
            </li>
          ))}
        </SheetDescription>
        <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-foreground px-4 py-2.5">
          <div>
            <p className="text-base font-semibold">Full Access</p>
            <p className="text-sm text-muted-foreground">Once, no subscription</p>
          </div>
          <p className="text-5xl font-extrabold tracking-tight">{FULL_ACCESS_PRICE_LABEL}</p>
        </div>
        <Button size="lg" className="mt-2 h-12 w-full text-base" disabled={busy} onClick={onPay}>
          {busy && <Spinner aria-hidden className="size-5" />}
          Pay {FULL_ACCESS_PRICE_LABEL}
        </Button>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          <Link href="/support/" className="underline">
            {MONEY_BACK_DAYS} days to get your money back
          </Link>
          .
        </p>
        <Button
          size="lg"
          variant="ghost"
          className="h-11 w-full text-base"
          disabled={busy}
          onClick={onClose}
        >
          Not now
        </Button>
        {email && (
          <p className="text-center text-xs text-muted-foreground">
            Buying for{' '}
            <span className="font-medium [overflow-wrap:anywhere] text-foreground">{email}</span>.
            Checkout uses this email, and refunds are looked up by it.
          </p>
        )}
      </SheetContent>
    </Sheet>
  )
}
