'use client'

import { useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { stopPlayback } from '@/lib/audio/player'
import { PAD_TOOT_TITLE, type Toot } from '@/lib/toot'
import { BackLink, useGoBack } from './back-link'
import { PadTootLayout } from './pad-toot-layout'
import { usePageHidden } from './page-hidden'
import { ShareButton, useShares } from './share-recording'
import { useSongCatalog } from './song-catalog-provider'
import { TootLayout } from './toot-layout'
import { useToots } from './toots-provider'
import { DeleteTootDialog, RenameTootDialog, TootMenu } from './toots-screen'
import { useSongNotes } from './use-song-notes'

export function TootScreen() {
  const id = useSearchParams().get('id') ?? ''
  const { toots, tootsFailed, toot: savedToot, forgetToot, deleteToot } = useToots()
  const { songs, songsFailed, song } = useSongCatalog()
  const backToToots = useGoBack('/toots/')
  const [isRenaming, setIsRenaming] = useState(false)
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
  const [lastSeen, setLastSeen] = useState<Toot | undefined>()
  const closing = useRef(false)
  const current = savedToot(id)
  const toot = current ?? (lastSeen?.id === id ? lastSeen : undefined)
  const summary = toot?.songId ? song(toot.songId) : undefined
  const notes = useSongNotes(summary)
  const isShared = useShares()?.tootLinks.has(id) ?? false
  const subtitle = [
    summary ? summary.title : toot?.songId === null ? PAD_TOOT_TITLE : null,
    isShared ? 'Shared' : null
  ]
    .filter(part => part !== null)
    .join(' · ')

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
      <header className="grid grid-cols-[5.5rem_1fr_5.5rem] items-center gap-1 px-2 pt-2 pb-3">
        <BackLink href="/toots/" label="Back to Toots" />
        {toot && (
          <>
            <div className="min-w-0 text-center">
              <h1 className="truncate font-semibold">{toot.title}</h1>
              {subtitle && (
                <p className="truncate text-xs text-muted-foreground" data-testid="toot-subtitle">
                  {subtitle}
                </p>
              )}
            </div>
            <div className="flex justify-end">
              {(!toot.isAudioMissing || isShared) && (
                <ShareButton kind="toots" id={toot.id} name={toot.title} className="size-11" />
              )}
              <TootMenu
                title={toot.title}
                onRename={() => setIsRenaming(true)}
                onDelete={() => setIsConfirmingDelete(true)}
              />
            </div>
          </>
        )}
      </header>

      {toots === null || (toot?.songId && songs === null && !songsFailed) ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : !toot ? (
        <p className="flex flex-1 items-center justify-center px-6 text-center text-muted-foreground">
          {tootsFailed ? "Couldn't load your Toots." : "Couldn't find this Toot."}
        </p>
      ) : toot.songId === null ? (
        <div className="px-4">
          <PadTootLayout toot={toot} isAudioMissing={toot.isAudioMissing}>
            {toot.isAudioMissing && (
              <p className="pt-1 text-xs text-muted-foreground" data-testid="toot-audio-missing">
                This Toot's audio is missing. You can delete it and record it again on the Sound
                Pad.
              </p>
            )}
          </PadTootLayout>
        </div>
      ) : !summary ? (
        <p className="flex flex-1 items-center justify-center px-6 text-center text-muted-foreground">
          {songsFailed ? "Couldn't load the Songs." : "This Toot's Song isn't in Farty any more."}
        </p>
      ) : (
        <TootLayout
          toot={toot}
          song={notes.song ?? summary}
          isAudioMissing={toot.isAudioMissing}
          notesFallback={
            notes.failed ? (
              <div
                className="flex flex-col items-center gap-3 py-4 text-center"
                data-testid="toot-notes-failed"
              >
                <p className="text-sm text-muted-foreground">Couldn't load this Song's notes.</p>
                <Button variant="outline" className="h-11 px-5 text-base" onClick={notes.retry}>
                  Try again
                </Button>
              </div>
            ) : (
              <div className="flex justify-center py-4">
                <Spinner />
              </div>
            )
          }
        >
          <p className="pt-1 text-xs text-muted-foreground">{summary.source}</p>
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
