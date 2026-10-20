'use client'

import dynamic from 'next/dynamic'
import { usePedos } from './pedos-provider'

/**
 * The Fixture Library loader, in internal builds only: `build:staging` sets
 * NEXT_PUBLIC_FIXTURE_LIBRARY, and `build:production` clears it, so the Production build carries
 * none of the loader (`scripts/fixture-library.ts check`).
 */
const FixtureLibrary =
  process.env.NEXT_PUBLIC_FIXTURE_LIBRARY === '1'
    ? dynamic(() => import('./fixture-library').then(m => m.FixtureLibrary), { ssr: false })
    : null

/**
 * The Profile tab, for now: the iPhone app's `ProfileTab` with its line for a new user and, in
 * internal builds, the Fixture Library. #112 brings the stats and the About section.
 */
export function ProfileScreen() {
  const pedos = usePedos()

  return (
    <div className="flex flex-1 flex-col px-4 pb-6">
      <h1 className="pt-4 pb-3 text-3xl font-bold tracking-tight">Profile</h1>
      {pedos.recordings?.length === 0 && (
        <p className="px-4 text-sm text-muted-foreground" data-testid="profile-new-user">
          Record your first fart on the Record tab. Collect notes to unlock Songs.
        </p>
      )}
      {FixtureLibrary && <FixtureLibrary />}
    </div>
  )
}
