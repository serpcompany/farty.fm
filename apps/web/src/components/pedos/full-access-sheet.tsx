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
  'Download any saved Toot as a file',
  "They're in your account, on any phone or tablet you sign in on"
]

/**
 * What Save, or a saved Toot's Download, asks of an account without Full Access (ADR 0022): what it
 * gets, the price, the money back and who's buying, with Pay and Not now, on one phone screen. Song
 * Creator's Toot stays in view above it. The Sound Pad's take sits under the Pads, so there it's
 * covered. Pay stays busy while the page goes to Checkout.
 *
 * `headline` is for where the default isn't true: Download opens on a Toot that's already saved.
 * `email` is the account's, which Checkout is given. A guest makes an account before this opens, so
 * it's theirs by then. With no email to show, the line is left out.
 */
export function FullAccessSheet({
  open,
  busy,
  email,
  headline = 'Keep this Toot, and every one after it.',
  onPay,
  onClose
}: {
  open: boolean
  busy: boolean
  email: string | null
  headline?: string
  onPay: () => void
  onClose: () => void
}) {
  return (
    <Sheet open={open} onOpenChange={next => !next && onClose()}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-dvh max-w-md gap-0 overflow-y-auto rounded-t-2xl px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        data-testid="full-access-sheet"
        showCloseButton={false}
      >
        <SheetTitle className="text-2xl leading-tight font-bold tracking-tight">
          {headline}
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
            <p className="text-base leading-tight font-semibold">Full Access</p>
            <p className="text-sm leading-tight text-muted-foreground">Once, no subscription</p>
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
