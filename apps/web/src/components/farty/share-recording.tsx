'use client'

import { Link2, Link2Off, Share } from 'lucide-react'
import { type ReactNode, useEffect, useEffectEvent, useState, useSyncExternalStore } from 'react'
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
import type { Recording } from '@/lib/recordings'
import {
  offerLink,
  readHandle,
  readShares,
  type Shared,
  type ShareKind,
  type Shares,
  shareItem,
  shareLink,
  stopSharing
} from '@/lib/sharing'
import { useAccount } from './account-provider'
import { HandleDialog } from './handle-dialog'
import { useNote } from './note'

let known: { accountId: string; shares: Shares; readAt: number } | null = null
let reading: string | null = null
const listeners = new Set<() => void>()

function setKnown(next: typeof known): void {
  known = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

async function refresh(accountId: string): Promise<void> {
  if (reading === accountId) return
  if (known?.accountId === accountId && Date.now() - known.readAt < 5_000) return
  reading = accountId
  try {
    const shares = await readShares(accountId)
    if (shares) setKnown({ accountId, shares, readAt: Date.now() })
  } finally {
    reading = null
  }
}

function remember(
  accountId: string,
  change: { handle?: string; item?: { kind: ShareKind; id: string; url: string | null } }
) {
  const shares: Shares =
    known?.accountId === accountId
      ? known.shares
      : { handle: null, links: new Map(), tootLinks: new Map() }
  const links = new Map(shares.links)
  const tootLinks = new Map(shares.tootLinks)
  const item = change.item
  if (item) {
    const changed = item.kind === 'toots' ? tootLinks : links
    if (item.url) changed.set(item.id, item.url)
    else changed.delete(item.id)
  }
  setKnown({
    accountId,
    shares: { handle: change.handle ?? shares.handle, links, tootLinks },
    readAt: known?.readAt ?? 0
  })
}

export function rememberHandle(accountId: string, handle: string): void {
  remember(accountId, { handle })
}

export function useShares(): Shares | null {
  const { account } = useAccount()
  const accountId = account.status === 'signedIn' ? account.id : null
  const current = useSyncExternalStore(
    subscribe,
    () => known,
    () => null
  )
  useEffect(() => {
    if (accountId) void refresh(accountId)
  }, [accountId])
  return accountId && current?.accountId === accountId ? current.shares : null
}

export function SharedMark() {
  return (
    <span className="inline-flex items-center gap-1" data-testid="recording-shared">
      <Link2 className="size-3.5" aria-hidden />
      Shared
    </span>
  )
}

const nouns: Record<ShareKind, string> = { recordings: 'Recording', toots: 'Toot' }

function failure(kind: ShareKind, error: Exclude<Shared, { url: string }>['error']): string {
  const what = nouns[kind]
  return {
    noHandle: "Couldn't share. Try again.",
    notUploaded: `This ${what} hasn't reached your account yet. Try again in a moment.`,
    takenDown: `This ${what} was taken down after a report, so it can’t be shared.`,
    deleted: `This ${what} was deleted.`,
    failed: "Couldn't share. Check your connection and try again."
  }[error]
}

const unreachable = "Couldn't reach Farty. Check your connection and try again."

export type ShareFlow = {
  link: string | null
  busy: boolean
  share: () => void
  shareLink: () => void
  stop: () => void
  dialogs: ReactNode
}

function StopSharingDialog({
  name,
  open,
  onOpenChange,
  onStop
}: {
  name: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onStop: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Stop sharing {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            The link stops working for everyone who has it. Sharing it again makes a new link.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11 text-base">Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" className="h-11 text-base" onClick={onStop}>
            Stop sharing
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function LinkReadyDialog({
  link,
  onClose,
  onShare
}: {
  link: string | null
  onClose: () => void
  onShare: (link: string) => void
}) {
  return (
    <AlertDialog open={link !== null} onOpenChange={open => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Your link is ready</AlertDialogTitle>
          <AlertDialogDescription className="break-all select-all">{link}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11 text-base">Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="h-11 text-base"
            onClick={() => {
              onClose()
              if (link) onShare(link)
            }}
          >
            Share link
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function useShare({ kind, id, name }: { kind: ShareKind; id: string; name: string }) {
  const { account, openStep } = useAccount()
  const shares = useShares()
  const accountId = account.status === 'signedIn' ? account.id : null
  const link = shareLink(shares, kind, id)
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState<{ suggestion: string } | null>(null)
  const [stopping, setStopping] = useState(false)
  const [ready, setReady] = useState<string | null>(null)
  const [note, setNote] = useNote()
  const [resume, setResume] = useState(false)

  const title = (handle: string | null) => (handle ? `${name} by @${handle}` : name)

  const offer = async (url: string, handle: string | null) => {
    const offered = await offerLink(url, title(handle))
    if (offered === 'copied') setNote('Link copied')
    if (offered === 'needsTap') setReady(url)
  }

  const share = async (account: string, handle: string) => {
    setBusy(true)
    const shared = await shareItem(kind, id, account)
    setBusy(false)
    if ('error' in shared) {
      setNote(failure(kind, shared.error))
      return
    }
    remember(account, { handle, item: { kind, id, url: shared.url } })
    await offer(shared.url, handle)
  }

  const start = async () => {
    if (account.status === 'signedOut' || account.status === 'expired') {
      openStep(() => setResume(true), 'share')
      return
    }
    if (!accountId) {
      setNote(unreachable)
      return
    }
    const handle = shares?.handle ?? null
    if (handle) return share(accountId, handle)
    setBusy(true)
    const read = await readHandle(accountId)
    setBusy(false)
    if (!read) setNote(unreachable)
    else if (read.handle) {
      remember(accountId, { handle: read.handle })
      await share(accountId, read.handle)
    } else setPicking({ suggestion: read.suggestion ?? '' })
  }

  const stop = async () => {
    setStopping(false)
    if (!accountId) return
    setBusy(true)
    const stopped = await stopSharing(kind, id, accountId)
    setBusy(false)
    if (stopped) remember(accountId, { item: { kind, id, url: null } })
    else setNote("Couldn't stop sharing. Check your connection and try again.")
  }

  const carryOn = useEffectEvent(() => void start())
  useEffect(() => {
    if (!resume || account.status === 'checking') return
    setResume(false)
    if (account.status === 'signedIn') carryOn()
  }, [resume, account.status])

  const dialogs = (
    <>
      {accountId && (
        <HandleDialog
          accountId={accountId}
          suggestion={picking?.suggestion ?? null}
          onClose={() => setPicking(null)}
          onPicked={handle => {
            setPicking(null)
            remember(accountId, { handle })
            void share(accountId, handle)
          }}
        />
      )}
      <StopSharingDialog
        name={name}
        open={stopping}
        onOpenChange={setStopping}
        onStop={() => void stop()}
      />
      <LinkReadyDialog
        link={ready}
        onClose={() => setReady(null)}
        onShare={url => void offer(url, shares?.handle ?? null)}
      />
      {note}
    </>
  )

  return {
    link,
    busy,
    share: () => void start(),
    shareLink: () => {
      if (link) void offer(link, shares?.handle ?? null)
    },
    stop: () => setStopping(true),
    dialogs
  } satisfies ShareFlow
}

export function ShareButton({
  kind,
  id,
  name,
  className
}: {
  kind: ShareKind
  id: string
  name: string
  className?: string
}) {
  const flow = useShare({ kind, id, name })
  const label = `Share ${name}`
  return (
    <>
      {flow.link ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label={label}
                disabled={flow.busy}
                className={className}
              />
            }
          >
            <Share />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto">
            <ShareMenuItems flow={flow} />
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          disabled={flow.busy}
          onClick={flow.share}
          className={className}
        >
          <Share />
        </Button>
      )}
      {flow.dialogs}
    </>
  )
}

export function ShareMenuItems({ flow }: { flow: ShareFlow }) {
  if (!flow.link) {
    return (
      <DropdownMenuItem
        className="min-h-11 px-3 text-base"
        disabled={flow.busy}
        onClick={flow.share}
      >
        <Share />
        Share
      </DropdownMenuItem>
    )
  }
  return (
    <>
      <DropdownMenuItem className="min-h-11 px-3 text-base" onClick={flow.shareLink}>
        <Share />
        Share link
      </DropdownMenuItem>
      <DropdownMenuItem
        variant="destructive"
        className="min-h-11 px-3 text-base"
        onClick={flow.stop}
      >
        <Link2Off />
        Stop sharing
      </DropdownMenuItem>
    </>
  )
}

export function ShareRecordingButton({ recording, name }: { recording: Recording; name: string }) {
  return <ShareButton kind="recordings" id={recording.id} name={name} />
}
