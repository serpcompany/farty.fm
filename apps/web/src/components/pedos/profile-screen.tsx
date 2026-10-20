'use client'

import { usePedos } from './pedos-provider'

/**
 * The Profile tab, for now: the iPhone app's `ProfileTab` with only its line for a new user.
 * #112 brings the stats and the About section.
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
    </div>
  )
}
