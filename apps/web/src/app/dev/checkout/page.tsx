import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

import { buttonVariants } from '@/components/ui/button'
import { songIndex } from '@/lib/catalog/song-index.generated'
import { FULL_ACCESS_PRICE_LABEL } from '@/lib/pricing'
import { cn } from '@/lib/utils'
import { devCheckoutServes } from '@/server/full-access'
import { isItemId } from '@/server/library-input'

export const metadata: Metadata = {
  title: 'Dev checkout · Farty',
  robots: { index: false, follow: false }
}
export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

// The dev checkout (ADR 0022): what Stripe Checkout's page is on a local run with no Stripe key,
// for the e2e journeys and tap-throughs. Pay gives the account Full Access
// (`POST /api/dev/checkout/`) and goes back to Song Creator, or the Sound Pad for a Toot with no
// `song` (ADR 0017), or the Toot's screen for a Download's (`return=toot`, #408), as Stripe would.
// It answers 404 anywhere but a local run on a local host, so never on Staging or Production.
export default async function DevCheckoutPage({ searchParams }: { searchParams: SearchParams }) {
  if (!devCheckoutServes((await headers()).get('host'))) notFound()
  const { toot, song: songId, return: returnTo } = await searchParams
  const forDownload = returnTo === 'toot'
  const song = forDownload || songId === undefined ? null : songIndex.find(s => s.id === songId)
  if (!isItemId(toot) || song === undefined) notFound()
  const cancel = forDownload
    ? `/toots/toot/?id=${toot}`
    : `${song ? `/compose/${song.id}/` : '/compose/pad/'}?toot=${toot}`
  return (
    <article className="flex flex-col gap-4 px-4 pt-4 pb-6">
      <h1 className="text-3xl font-bold tracking-tight">Dev checkout</h1>
      <p className="text-sm text-muted-foreground">
        Stripe Checkout's stand-in on a local run. Nothing is charged.
      </p>
      <p>
        Farty Full Access: <span className="font-semibold">{FULL_ACCESS_PRICE_LABEL}</span>
      </p>
      <form method="post" action="/api/dev/checkout/" className="flex flex-col gap-3">
        <input type="hidden" name="toot" value={toot} />
        {song && <input type="hidden" name="song" value={song.id} />}
        {forDownload && <input type="hidden" name="return" value="toot" />}
        <button type="submit" className={cn(buttonVariants(), 'h-12 w-full text-base')}>
          Pay {FULL_ACCESS_PRICE_LABEL}
        </button>
        {/* A whole page load, as Stripe's cancel URL is. */}
        <a
          href={cancel}
          className={cn(buttonVariants({ variant: 'outline' }), 'h-12 w-full text-base')}
        >
          Cancel
        </a>
      </form>
    </article>
  )
}
