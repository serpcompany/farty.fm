'use client'

import { Ellipsis, ListMusic, Pencil, Play, Square, Trash2, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
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
import { songs } from '@/lib/catalog/songs.generated'
import { type Toot, tootDetails } from '@/lib/toot'
import { cn } from '@/lib/utils'
import { tootPlayback, usePedos } from './pedos-provider'

/** Where a Toot's screen is: one page for every Toot, since a Toot's id is made on the device. */
export function tootPage(id: string): string {
  return `/toots/toot/?id=${encodeURIComponent(id)}`
}

/**
 * Every Toot, newest first. Tap a row's play button to play it, or the row to open it; its More
 * menu renames or deletes it (the iPhone app's long-press and swipe). As the iPhone app's
 * `TootsTab`.
 */
export function TootsScreen() {
  const pedos = usePedos()
  const [renaming, setRenaming] = useState<Toot | null>(null)
  const [deleting, setDeleting] = useState<Toot | null>(null)
  const [missingAudio, setMissingAudio] = useState<Toot | null>(null)

  // The page comes back on the Record tab, so nothing is left open here.
  useEffect(() => {
    const visibilityChanged = () => {
      if (document.visibilityState !== 'hidden') return
      setRenaming(null)
      setDeleting(null)
      setMissingAudio(null)
    }
    document.addEventListener('visibilitychange', visibilityChanged)
    return () => document.removeEventListener('visibilitychange', visibilityChanged)
  }, [])

  // Leaving the list lets go of the audio its rows decoded. A Toot playing keeps playing into its
  // screen, as on the iPhone; another tab stops it (`AppShell`).
  const { toots, forgetToot } = pedos
  const ids = toots?.map(t => t.id).join(' ') ?? ''
  useEffect(() => () => ids.split(' ').filter(Boolean).forEach(forgetToot), [ids, forgetToot])

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
      {/* A Toot saved since a failed load still shows, under the line. */}
      {pedos.tootsFailed && (
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
        !pedos.tootsFailed && (
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
                else pedos.toggleTootPlayback(toot)
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
                if (missingAudio) pedos.deleteToot(missingAudio.id)
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
        onDelete={toot => pedos.deleteToot(toot.id)}
      />
    </div>
  )
}

/**
 * A Toot's row: a play button, then the title and the Song it came from, its date and length,
 * which open the Toot's screen, and its More menu. As the iPhone app's `TootRow`.
 */
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
  const pedos = usePedos()
  const isPlaying = pedos.nowPlaying === tootPlayback(toot.id)
  const songTitle = songs.find(song => song.id === toot.songId)?.title ?? ''
  const details = tootDetails(toot, songTitle)
  const Icon = toot.isAudioMissing ? TriangleAlert : isPlaying ? Square : Play

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
      <TootMenu title={toot.title} onRename={onRename} onDelete={onDelete} />
    </li>
  )
}

/** Rename and Delete, behind More. */
export function TootMenu({
  title,
  onRename,
  onDelete
}: {
  title: string
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

/** Gives a Toot a new name. Shows while `toot` is set. As the iPhone app's Rename alert. */
export function RenameTootDialog({ toot, onClose }: { toot: Toot | null; onClose: () => void }) {
  const pedos = usePedos()
  const [title, setTitle] = useState('')
  const [shown, setShown] = useState<Toot | null>(null)
  // Starts from the Toot's name each time it opens.
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
            if (toot) pedos.renameToot(toot.id, title)
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

/** Asks before deleting a Toot. Shows while `toot` is set. */
export function DeleteTootDialog({
  toot,
  onClose,
  onDelete
}: {
  toot: Toot | null
  onClose: () => void
  onDelete: (toot: Toot) => void
}) {
  return (
    <AlertDialog open={toot !== null} onOpenChange={open => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {toot?.title}?</AlertDialogTitle>
          <AlertDialogDescription>This can't be undone.</AlertDialogDescription>
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
