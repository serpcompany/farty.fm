'use client'

import { Ellipsis, ListMusic, Pencil, Play, Square, Trash2, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import type { SongSummary } from '@/lib/catalog/song'
import { PAD_TOOT_TITLE, type Toot, tootDetails } from '@/lib/toot'
import { cn } from '@/lib/utils'
import { AccountFullNotice } from './account-full-notice'
import { usePageHidden } from './page-hidden'
import { usePlayback } from './playback-provider'
import { type ShareFlow, ShareMenuItems, useShare, useShares } from './share-recording'
import { useSongCatalog } from './song-catalog-provider'
import { SongsFailed } from './songs-failed'
import { tootPlayback, useToots } from './toots-provider'

function tootPage(id: string): string {
  return `/toots/toot/?id=${encodeURIComponent(id)}`
}

function tootSongTitle(
  toot: Toot,
  song: (id: string) => SongSummary | undefined,
  catalogLoading: boolean
): string {
  if (toot.songId === null) return PAD_TOOT_TITLE
  return song(toot.songId)?.title ?? (catalogLoading ? 'Loading…' : 'Song')
}

export function TootsScreen() {
  const { toots, tootsFailed, forgetToot, toggleTootPlayback, deleteToot } = useToots()
  const { songsFailed } = useSongCatalog()
  const [renaming, setRenaming] = useState<Toot | null>(null)
  const [deleting, setDeleting] = useState<Toot | null>(null)
  const [missingAudio, setMissingAudio] = useState<Toot | null>(null)
  usePageHidden(() => {
    setRenaming(null)
    setDeleting(null)
    setMissingAudio(null)
  })

  const shown = useRef<string[]>([])
  useEffect(() => {
    shown.current = toots?.map(t => t.id) ?? []
  }, [toots])
  useEffect(() => () => shown.current.forEach(forgetToot), [forgetToot])

  if (toots === null) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col px-4 pb-6">
      <h1 className="pt-4 pb-3 text-3xl font-bold tracking-tight">Toots</h1>
      <AccountFullNotice kind="toots" />
      {songsFailed && toots.some(toot => toot.songId !== null) && (
        <SongsFailed className="flex items-center justify-between gap-3 pb-3 pl-4" />
      )}
      {tootsFailed && (
        <p
          className={cn(
            'px-4 text-center text-muted-foreground',
            toots.length === 0 ? 'flex flex-1 items-center justify-center' : 'pb-3'
          )}
        >
          Couldn't load your Toots.
        </p>
      )}
      {toots.length === 0 ? (
        !tootsFailed && (
          <Empty className="flex-1">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ListMusic />
              </EmptyMedia>
              <EmptyTitle>Nothing yet</EmptyTitle>
              <EmptyDescription>Make one in Compose.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl bg-muted/60" data-testid="toots-list">
          {toots.map(toot => (
            <TootRow
              key={toot.id}
              toot={toot}
              onPlay={() => {
                if (toot.isAudioMissing) setMissingAudio(toot)
                else toggleTootPlayback(toot)
              }}
              onRename={() => setRenaming(toot)}
              onDelete={() => setDeleting(toot)}
            />
          ))}
        </ul>
      )}

      <AlertDialog
        open={missingAudio !== null}
        onOpenChange={open => !open && setMissingAudio(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>This Toot's audio is missing</AlertDialogTitle>
            <AlertDialogDescription>
              It can't be played. You can delete it and make it again in Compose.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 text-base">Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              className="h-11 text-base"
              onClick={() => {
                if (missingAudio) deleteToot(missingAudio.id)
                setMissingAudio(null)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <RenameTootDialog toot={renaming} onClose={() => setRenaming(null)} />
      <DeleteTootDialog
        toot={deleting}
        onClose={() => setDeleting(null)}
        onDelete={toot => deleteToot(toot.id)}
      />
    </div>
  )
}

function TootRow({
  toot,
  onPlay,
  onRename,
  onDelete
}: {
  toot: Toot
  onPlay: () => void
  onRename: () => void
  onDelete: () => void
}) {
  const { nowPlaying } = usePlayback()
  const { tootPlayFailed } = useToots()
  const { songs, songsFailed, song } = useSongCatalog()
  const isPlaying = nowPlaying === tootPlayback(toot.id)
  const songTitle = tootSongTitle(toot, song, songs === null && !songsFailed)
  const details =
    tootPlayFailed === toot.id ? `${songTitle} · Couldn't play` : tootDetails(toot, songTitle)
  const Icon = toot.isAudioMissing ? TriangleAlert : isPlaying ? Square : Play
  const share = useShare({ kind: 'toots', id: toot.id, name: toot.title })

  return (
    <li
      className={cn('flex items-center gap-1 py-1.5 pr-1 pl-2', isPlaying && 'bg-primary/10')}
      data-testid="toot-row"
    >
      <button
        type="button"
        aria-label={
          toot.isAudioMissing
            ? `${toot.title}: audio missing`
            : `${isPlaying ? 'Stop' : 'Play'} ${toot.title}`
        }
        className={cn(
          'flex size-11 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
          toot.isAudioMissing ? 'text-muted-foreground' : 'text-primary'
        )}
        onClick={onPlay}
      >
        <Icon className={cn('size-5', !toot.isAudioMissing && 'fill-current')} />
      </button>
      <Link
        href={tootPage(toot.id)}
        className="flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-0.5 rounded-lg py-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="truncate">{toot.title}</span>
        <span className="truncate text-sm text-muted-foreground" data-testid="toot-details">
          {details}
        </span>
      </Link>
      <TootMenu
        title={toot.title}
        share={toot.isAudioMissing && !share.link ? undefined : share}
        onRename={onRename}
        onDelete={onDelete}
      />
      {share.dialogs}
    </li>
  )
}

export function TootMenu({
  title,
  share,
  onRename,
  onDelete
}: {
  title: string
  share?: ShareFlow
  onRename: () => void
  onDelete: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-11 shrink-0"
            aria-label={`More for ${title}`}
          />
        }
      >
        <Ellipsis className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto">
        {share && <ShareMenuItems flow={share} />}
        <DropdownMenuItem className="min-h-11 px-3 text-base" onClick={onRename}>
          <Pencil />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          className="min-h-11 px-3 text-base"
          onClick={onDelete}
        >
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function RenameTootDialog({ toot, onClose }: { toot: Toot | null; onClose: () => void }) {
  const { renameToot } = useToots()
  const [title, setTitle] = useState('')
  const [shown, setShown] = useState<Toot | null>(null)
  if (toot !== shown) {
    setShown(toot)
    if (toot) setTitle(toot.title)
  }

  return (
    <AlertDialog open={toot !== null} onOpenChange={open => !open && onClose()}>
      <AlertDialogContent>
        <form
          className="grid gap-4"
          onSubmit={event => {
            event.preventDefault()
            if (toot) renameToot(toot.id, title)
            onClose()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Rename</AlertDialogTitle>
          </AlertDialogHeader>
          <Input
            aria-label="Name"
            placeholder="Name"
            value={title}
            onChange={event => setTitle(event.target.value)}
            className="h-11 text-base"
          />
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 text-base">Cancel</AlertDialogCancel>
            <Button type="submit" className="h-11 text-base">
              Save
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function DeleteTootDialog({
  toot,
  onClose,
  onDelete
}: {
  toot: Toot | null
  onClose: () => void
  onDelete: (toot: Toot) => void
}) {
  const shared = useShares()?.tootLinks.has(toot?.id ?? '') ?? false
  return (
    <AlertDialog open={toot !== null} onOpenChange={open => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {toot?.title}?</AlertDialogTitle>
          <AlertDialogDescription>
            {shared && 'Its link stops working too. '}This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11 text-base">Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            className="h-11 text-base"
            onClick={() => {
              if (toot) onDelete(toot)
              onClose()
            }}
          >
            Delete Toot
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
