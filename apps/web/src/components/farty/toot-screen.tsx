'use client'

import { useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Spinner } from '@/components/ui/spinner'
import { stopPlayback } from '@/lib/audio/player'
import { songs } from '@/lib/catalog/songs.generated'
import type { Toot } from '@/lib/toot'
import { BackLink, useGoBack } from './back-link'
import { usePageHidden } from './page-hidden'
import { TootLayout } from './toot-layout'
import { useToots } from './toots-provider'
import { DeleteTootDialog, RenameTootDialog, TootMenu } from './toots-screen'

export function TootScreen() {
  const id = useSearchParams().get('id') ?? ''
  const { toots, tootsFailed, toot: savedToot, forgetToot, deleteToot } = useToots()
  const backToToots = useGoBack('/toots/')
  const [isRenaming, setIsRenaming] = useState(false)
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
  const [lastSeen, setLastSeen] = useState<Toot | undefined>()
  const closing = useRef(false)
  const current = savedToot(id)
  const toot = current ?? (lastSeen?.id === id ? lastSeen : undefined)
  const song = toot && songs.find(s => s.id === toot.songId)

  useEffect(() => {
    if (current) setLastSeen(current)
  }, [current])

  usePageHidden(() => {
    setIsRenaming(false)
    setIsConfirmingDelete(false)
  })

  useEffect(() => stopPlayback, [])
  useEffect(() => () => forgetToot(id), [id, forgetToot])

  return (
    <div className="flex flex-1 flex-col">
      <header className="grid grid-cols-[2.75rem_1fr_2.75rem] items-center gap-2 px-2 pt-2 pb-3">
        <BackLink href="/toots/" label="Back to Toots" />
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

      {toots === null ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : !toot ? (
        <p className="flex flex-1 items-center justify-center px-6 text-center text-muted-foreground">
          {tootsFailed ? "Couldn't load your Toots." : "Couldn't find this Toot."}
        </p>
      ) : !song ? (
        <p className="flex flex-1 items-center justify-center px-6 text-center text-muted-foreground">
          This Toot's Song isn't in Farty any more.
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
          deleteToot(deleted.id)
          backToToots()
        }}
      />
    </div>
  )
}
