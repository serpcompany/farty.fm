'use client'

import { ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { buttonVariants } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { songs } from '@/lib/catalog/songs.generated'
import type { Toot } from '@/lib/toot'
import { cn } from '@/lib/utils'
import { usePedos } from './pedos-provider'
import { previousPage } from './previous-page'
import { TootLayout } from './song-creator'
import { DeleteTootDialog, RenameTootDialog, TootMenu } from './toots-screen'

/**
 * A Toot's screen, opened from the Toots tab: Song Creator's layout without Save, showing which
 * Recording played which notes. Rename and Delete are in its More menu. As the iPhone app's
 * `TootDetailView`. The Toot is `?id=`, so one page serves every Toot, offline too.
 */
export function TootScreen() {
  const id = useSearchParams().get('id') ?? ''
  const pedos = usePedos()
  const router = useRouter()
  const [isRenaming, setIsRenaming] = useState(false)
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
  /** The Toot as last seen, renamed or not, so the screen keeps it while it closes after Delete. */
  const [lastSeen, setLastSeen] = useState<Toot | undefined>()
  /** Delete went back already, so a second tap doesn't go back past the Toots tab. */
  const closing = useRef(false)
  const current = pedos.toot(id)
  const toot = current ?? (lastSeen?.id === id ? lastSeen : undefined)
  const song = toot && songs.find(s => s.id === toot.songId)

  useEffect(() => {
    if (current) setLastSeen(current)
  }, [current])

  // The page comes back on the Record tab, so nothing is left open here.
  useEffect(() => {
    const visibilityChanged = () => {
      if (document.visibilityState !== 'hidden') return
      setIsRenaming(false)
      setIsConfirmingDelete(false)
    }
    document.addEventListener('visibilitychange', visibilityChanged)
    return () => document.removeEventListener('visibilitychange', visibilityChanged)
  }, [])

  // Leaving the screen stops its sound and lets go of its decoded audio.
  const { stopPlayback, forgetToot } = pedos
  useEffect(() => stopPlayback, [stopPlayback])
  useEffect(() => () => forgetToot(id), [id, forgetToot])

  /** Back to the Toots it came from, or in its place, so the system Back never opens it again. */
  const backToToots = () => {
    if (previousPage()?.replace(/\/$/, '') === '/toots') router.back()
    else router.replace('/toots/')
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="grid grid-cols-[2.75rem_1fr_2.75rem] items-center gap-2 px-2 pt-2 pb-3">
        <Link
          href="/toots/"
          replace
          onClick={event => {
            if (previousPage()?.replace(/\/$/, '') !== '/toots') return
            event.preventDefault()
            router.back()
          }}
          aria-label="Back to Toots"
          className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'size-11')}
        >
          <ChevronLeft className="size-6" />
        </Link>
        {toot && (
          <>
            <div className="min-w-0 text-center">
              <h1 className="truncate font-semibold">{toot.title}</h1>
              {song && <p className="truncate text-xs text-muted-foreground">{song.title}</p>}
            </div>
            <TootMenu
              title={toot.title}
              onRename={() => setIsRenaming(true)}
              onDelete={() => setIsConfirmingDelete(true)}
            />
          </>
        )}
      </header>

      {pedos.toots === null ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : !toot ? (
        <p className="flex flex-1 items-center justify-center px-6 text-center text-muted-foreground">
          {pedos.tootsFailed ? "Couldn't load your Toots." : "Couldn't find this Toot."}
        </p>
      ) : !song ? (
        <p className="flex flex-1 items-center justify-center px-6 text-center text-muted-foreground">
          This Toot's Song isn't in Pedos any more.
        </p>
      ) : (
        <TootLayout toot={toot} song={song} isAudioMissing={toot.isAudioMissing}>
          <p className="pt-1 text-xs text-muted-foreground">{song.source}</p>
          {toot.isAudioMissing && (
            <p className="pt-1 text-xs text-muted-foreground" data-testid="toot-audio-missing">
              This Toot's audio is missing. You can delete it and make it again in Compose.
            </p>
          )}
        </TootLayout>
      )}

      <RenameTootDialog
        toot={isRenaming && toot ? toot : null}
        onClose={() => setIsRenaming(false)}
      />
      <DeleteTootDialog
        toot={isConfirmingDelete && toot ? toot : null}
        onClose={() => setIsConfirmingDelete(false)}
        onDelete={deleted => {
          if (closing.current) return
          closing.current = true
          pedos.deleteToot(deleted.id)
          backToToots()
        }}
      />
    </div>
  )
}
