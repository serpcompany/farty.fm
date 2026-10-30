import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

import { buttonVariants } from '@/components/ui/button'
import { songs } from '@/lib/catalog/songs.generated'
import { TOOT_PRICE_LABEL } from '@/lib/pricing'
import { cn } from '@/lib/utils'
import { isItemId } from '@/server/library-input'
import { devCheckoutServes } from '@/server/toot-payments'

export const metadata: Metadata = {
  title: 'Dev checkout · Farty',
  robots: { index: false, follow: false }
}
export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

// The dev checkout (ADR 0010): what Stripe Checkout's page is on a local run with no Stripe key,
// for the e2e journeys and tap-throughs. Pay marks the Toot paid (`POST /api/dev/checkout/`) and
// goes back to Song Creator, or the Sound Pad for a Toot with no `song` (ADR 0017), as Stripe
// would. It answers 404 anywhere but a local run on a local
// host, so never on Staging or Production.
export default async function DevCheckoutPage({ searchParams }: { searchParams: SearchParams }) {
  if (!devCheckoutServes((await headers()).get('host'))) notFound()
  const { toot, song: songId } = await searchParams
  const song = songId === undefined ? null : songs.find(s => s.id === songId)
  if (!isItemId(toot) || song === undefined) notFound()
  const back = song ? `/compose/${song.id}/` : '/compose/pad/'
  return (
    <article className="flex flex-col gap-4 px-4 pt-4 pb-6">
      <h1 className="text-3xl font-bold tracking-tight">Dev checkout</h1>
      <p className="text-sm text-muted-foreground">
        Stripe Checkout's stand-in on a local run. Nothing is charged.
      </p>
      <p>
        {song ? `Save your Toot of ${song.title}` : 'Save your Sound Pad Toot'}:{' '}
        <span className="font-semibold">{TOOT_PRICE_LABEL}</span>
      </p>
      <form method="post" action="/api/dev/checkout/" className="flex flex-col gap-3">
        <input type="hidden" name="toot" value={toot} />
        {song && <input type="hidden" name="song" value={song.id} />}
        <button type="submit" className={cn(buttonVariants(), 'h-12 w-full text-base')}>
          Pay {TOOT_PRICE_LABEL}
        </button>
        {/* A whole page load, as Stripe's cancel URL is. */}
        <a
          href={`${back}?toot=${toot}`}
          className={cn(buttonVariants({ variant: 'outline' }), 'h-12 w-full text-base')}
        >
          Cancel
        </a>
      </form>
    </article>
  )
}
