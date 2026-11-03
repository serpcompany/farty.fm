'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useEffectEvent, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { stopPlayback } from '@/lib/audio/player'
import type { Song } from '@/lib/catalog/song'
import { reportError } from '@/lib/telemetry/errors'
import type { SongTootDraft } from '@/lib/toot'
import { type CheckoutReturn, readCheckoutReturn } from '@/lib/toot-payment'
import { TootError } from '@/lib/toot-renderer'
import { BackLink } from './back-link'
import { FavoriteButton } from './favorite-button'
import { useRecordings } from './recordings-provider'
import { SaveToToots } from './save-to-toots'
import { useSongCatalog } from './song-catalog-provider'
import { TootLayout } from './toot-layout'
import { useToots } from './toots-provider'
import { useSongNotes } from './use-song-notes'

type Phase =
  | { kind: 'making' }
  | { kind: 'ready'; draft: SongTootDraft; back: CheckoutReturn | null }
  | { kind: 'locked' }
  | { kind: 'failed' }

type SongHeading = Pick<Song, 'id' | 'title' | 'source'>

function canPlayWithoutTap(): boolean {
  return navigator.userActivation?.hasBeenActive ?? true
}

function causeOf(error: unknown): unknown {
  return error instanceof TootError ? (error.cause ?? error) : error
}

function failedMessage(songsFailed: boolean, notesFailed: boolean): string {
  if (songsFailed) return "Couldn't load the Songs."
  return notesFailed ? "Couldn't load this Song." : "Couldn't make this Toot."
}

export function SongCreator({ id, heading }: { id: string; heading?: SongHeading }) {
  const { recordings, makeToot } = useRecordings()
  const { toggleTootPlayback, forgetToot } = useToots()
  const { songs, songsFailed, reloadSongs, song: songOf } = useSongCatalog()
  const summary = songOf(id)
  const notes = useSongNotes(summary)
  const song = notes.song
  const shown = summary ?? heading
  const [phase, setPhase] = useState<Phase>({ kind: 'making' })
  const loaded = recordings !== null && song !== null
  const making = phase.kind === 'making'
  const catalogFailed = summary === undefined && songsFailed
  const view =
    catalogFailed || notes.failed
      ? 'failed'
      : summary === undefined && songs !== null
        ? 'missing'
        : phase.kind

  const make = useEffectEvent(async (song: Song) => {
    const back = readCheckoutReturn()
    return { draft: await makeToot(song, back?.tootId), back }
  })
  const playOnce = useEffectEvent((draft: SongTootDraft) => {
    if (canPlayWithoutTap()) toggleTootPlayback(draft)
  })

  useEffect(() => {
    if (!loaded || !song || !making) return
    let left = false
    make(song).then(
      ({ draft, back }) => {
        if (left) return
        setPhase({ kind: 'ready', draft, back })
        if (!back) playOnce(draft)
      },
      error => {
        const locked = error instanceof TootError && error.reason === 'locked'
        if (!locked) reportError('toot-make-failed', causeOf(error))
        if (left) return
        setPhase({ kind: locked ? 'locked' : 'failed' })
      }
    )
    return () => {
      left = true
    }
  }, [loaded, song, making])

  useEffect(() => stopPlayback, [])
  const draftId = phase.kind === 'ready' ? phase.draft.id : null
  useEffect(() => {
    if (draftId) return () => forgetToot(draftId)
  }, [draftId, forgetToot])

  return (
    <div className="flex flex-1 flex-col">
      <header className="grid grid-cols-[2.75rem_1fr_2.75rem] items-center gap-2 px-2 pt-2 pb-3">
        <BackLink href="/compose/" label="Back to Compose" />
        <div className="min-w-0 text-center">
          <h1 className="truncate font-semibold">{shown?.title}</h1>
          <p className="truncate text-xs text-muted-foreground">{shown?.source}</p>
        </div>
        {shown && <FavoriteButton song={shown} />}
      </header>

      {view === 'making' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <Spinner className="size-6" />
          <p>Making your Toot…</p>
        </div>
      )}
      {view === 'missing' && (
        <p className="flex flex-1 items-center justify-center px-6 text-center text-muted-foreground">
          Couldn't find this Song.
        </p>
      )}
      {view === 'locked' && (
        <p className="flex flex-1 items-center justify-center px-6 text-center text-muted-foreground">
          This Song is locked. Record the notes it needs to unlock it.
        </p>
      )}
      {view === 'failed' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-muted-foreground">{failedMessage(songsFailed, notes.failed)}</p>
          <Button
            variant="outline"
            className="h-11 px-5 text-base"
            onClick={() => {
              if (songsFailed) reloadSongs()
              if (notes.failed) notes.retry()
              setPhase({ kind: 'making' })
            }}
          >
            Try again
          </Button>
        </div>
      )}
      {view === 'ready' && phase.kind === 'ready' && (
        <>
          <TootLayout toot={phase.draft} song={phase.draft.song} />
          <SaveToToots draft={phase.draft} back={phase.back} />
        </>
      )}
    </div>
  )
}

const songIdIn = (path: string) => /^\/compose\/([^/]+)/.exec(path)?.[1] ?? ''

export function SongCreatorFromAddress() {
  const id = songIdIn(usePathname())
  const title = useSongCatalog().song(id)?.title
  useEffect(() => {
    if (!title) return
    const wanted = `${title} · Farty`
    const keepTheSongsTitle = () => {
      if (songIdIn(location.pathname) === id && document.title !== wanted) document.title = wanted
    }
    keepTheSongsTitle()
    const observer = new MutationObserver(keepTheSongsTitle)
    observer.observe(document.head, { childList: true, characterData: true, subtree: true })
    return () => observer.disconnect()
  }, [id, title])
  return <SongCreator id={id} />
}
