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
import { Input } from '@/components/ui/input'
import {
  HANDLE_MAX,
  HANDLE_MIN,
  type HandleProblem,
  handleMessage,
  handleProblem,
  normalizeHandle
} from '@/lib/handle'
import type { Recording } from '@/lib/recordings'
import {
  checkHandle,
  offerLink,
  pickHandle,
  readHandle,
  readShares,
  type Shared,
  type ShareKind,
  type Shares,
  shareItem,
  shareLink,
  stopSharing
} from '@/lib/sharing'
import { cn } from '@/lib/utils'
import { useAccount } from './account-provider'

// Share on a Recording's row, and on a saved Toot's screen and row (ADR 0020): the first time, a
// Handle; then the link, to the phone's share sheet or the clipboard. A shared item's Share offers
// Share link or Stop sharing. A guest makes a free account first.

/** The signed-in account's Handle and shared items, as last read, for every row. */
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

/** Reads the account's shares, unless they were read in the last few seconds. */
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

/** Keeps the Handle the user just picked somewhere else, such as to add a friend (#319). */
export function rememberHandle(accountId: string, handle: string): void {
  remember(accountId, { handle })
}

/** The signed-in account's Handle and shared items, or null until read or when signed out. */
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

/** "Shared", under a shared Recording's waveform. */
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

/** One item's Share, as `useShare` gives it: its link, and what each control does. */
export type ShareFlow = {
  /** Its link, while it's shared. */
  link: string | null
  /** A link is being made or stopped. */
  busy: boolean
  /** Share, from the top: an account, then a Handle, then the link. */
  share: () => void
  /** Offers the link it already has again. */
  shareLink: () => void
  /** Asks before it stops sharing. */
  stop: () => void
  /** The Handle picker, Stop sharing's question, the link the browser held back, and the note. */
  dialogs: ReactNode
}

/**
 * Share for one Recording or saved Toot, whichever control it's behind: a row's button, a
 * screen's header or a More menu. `name` is the item's, as its row shows it. Render `dialogs`
 * outside any menu, so they stay open once it closes.
 */
export function useShare({ kind, id, name }: { kind: ShareKind; id: string; name: string }) {
  const { account, openStep } = useAccount()
  const shares = useShares()
  const accountId = account.status === 'signedIn' ? account.id : null
  const link = shareLink(shares, kind, id)
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState<{ suggestion: string } | null>(null)
  const [stopping, setStopping] = useState(false)
  /** A link the browser wouldn't hand to the share sheet without a fresh tap. */
  const [ready, setReady] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  /** A guest's Share, which carries on once the account step closes signed in. */
  const [resume, setResume] = useState(false)

  useEffect(() => {
    if (note === null) return
    const timer = setTimeout(() => setNote(null), 3_000)
    return () => clearTimeout(timer)
  }, [note])

  const title = (handle: string | null) => (handle ? `${name} by @${handle}` : name)

  const offer = async (url: string, handle: string | null) => {
    const offered = await offerLink(url, title(handle))
    if (offered === 'copied') setNote('Link copied')
    if (offered === 'needsTap') setReady(url)
  }

  /** Makes the link with the user's Handle, then offers it. */
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

  /** Share, from the top: an account, then a Handle, then the link. */
  const start = async () => {
    if (account.status === 'signedOut' || account.status === 'expired') {
      openStep(() => setResume(true), 'share')
      return
    }
    if (!accountId) {
      setNote("Couldn't reach Farty. Check your connection and try again.")
      return
    }
    const handle = shares?.handle ?? null
    if (handle) return share(accountId, handle)
    setBusy(true)
    const read = await readHandle(accountId)
    setBusy(false)
    if (!read) setNote("Couldn't reach Farty. Check your connection and try again.")
    else if (read.handle) {
      remember(accountId, { handle: read.handle })
      await share(accountId, read.handle)
    } else setPicking({ suggestion: read.suggestion ?? '' })
  }

  // Back from the account step: carry on if it signed in. The step closes either way.
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

      <AlertDialog open={stopping} onOpenChange={setStopping}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop sharing {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The link stops working for everyone who has it. Sharing it again makes a new link.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 text-base">Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              className="h-11 text-base"
              onClick={async () => {
                setStopping(false)
                if (!accountId) return
                setBusy(true)
                const stopped = await stopSharing(kind, id, accountId)
                setBusy(false)
                if (stopped) remember(accountId, { item: { kind, id, url: null } })
                else setNote("Couldn't stop sharing. Check your connection and try again.")
              }}
            >
              Stop sharing
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={ready !== null} onOpenChange={open => !open && setReady(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Your link is ready</AlertDialogTitle>
            <AlertDialogDescription className="break-all select-all">
              {ready}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 text-base">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 text-base"
              onClick={() => {
                const url = ready
                setReady(null)
                // Straight from the tap, so the browser lets the share sheet open.
                if (url) void offer(url, shares?.handle ?? null)
              }}
            >
              Share link
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {note && (
        <output
          aria-live="polite"
          className="fixed inset-x-0 bottom-24 z-50 mx-auto w-fit max-w-[calc(100%-2rem)] rounded-full bg-foreground px-4 py-2 text-center text-sm text-background shadow-lg md:top-20 md:bottom-auto"
        >
          {note}
        </output>
      )}
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

/**
 * Share as a button of its own: shares the item, or, once it's shared, offers Share link and Stop
 * sharing. `name` is the item's, as its row shows it.
 */
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

/**
 * Share's items in a menu: Share while the item isn't shared, or Share link and Stop sharing once
 * it is.
 */
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

/** The row's Share on a Recording. `name` is the Recording's, as its row shows it. */
export function ShareRecordingButton({ recording, name }: { recording: Recording; name: string }) {
  return <ShareButton kind="recordings" id={recording.id} name={name} />
}

type Check = { handle: string; problem: HandleProblem | null } | { handle: string; checking: true }

/**
 * Pick a handle: asked the first time someone shares or adds a friend, filled in from their email
 * when that Handle is free, and checked as they type. Shows while `suggestion` is set. `action` is
 * what the button does next: Share, or Add friend.
 */
export function HandleDialog({
  accountId,
  suggestion,
  action = 'Share',
  onClose,
  onPicked
}: {
  accountId: string
  suggestion: string | null
  action?: string
  onClose: () => void
  onPicked: (handle: string) => void
}) {
  const [typed, setTyped] = useState('')
  const [shown, setShown] = useState<string | null>(null)
  const [check, setCheck] = useState<Check | null>(null)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  // Starts from the suggestion each time it opens.
  if (suggestion !== shown) {
    setShown(suggestion)
    if (suggestion !== null) {
      setTyped(suggestion)
      setCheck(null)
      setFailed(false)
    }
  }

  const handle = normalizeHandle(typed)
  const local = handle === '' ? null : handleProblem(handle)

  // Asks the server whether a well-formed Handle is free, once typing pauses.
  useEffect(() => {
    if (suggestion === null || handle === '' || local !== null) return
    setCheck({ handle, checking: true })
    const timer = setTimeout(async () => {
      const problem = await checkHandle(handle, accountId)
      if (problem === 'unreachable') setCheck(null)
      else setCheck(current => (current?.handle === handle ? { handle, problem } : current))
    }, 300)
    return () => clearTimeout(timer)
  }, [accountId, handle, local, suggestion])

  const checked = check && check.handle === handle && 'problem' in check ? check : null
  const problem = local ?? checked?.problem ?? null
  const free = handle !== '' && local === null && checked !== null && checked.problem === null
  const message =
    handle === ''
      ? `${HANDLE_MIN} to ${HANDLE_MAX} letters, numbers or _`
      : problem
        ? handleMessage(handle, problem)
        : free
          ? handleMessage(handle, null)
          : 'Checking…'

  return (
    <AlertDialog open={suggestion !== null} onOpenChange={open => !open && onClose()}>
      <AlertDialogContent>
        <form
          className="grid gap-4"
          onSubmit={async event => {
            event.preventDefault()
            if (!free || saving) return
            setSaving(true)
            setFailed(false)
            const picked = await pickHandle(handle, accountId)
            setSaving(false)
            if ('handle' in picked) onPicked(picked.handle)
            else if ('problem' in picked) setCheck({ handle, problem: picked.problem })
            else setFailed(true)
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Pick a handle</AlertDialogTitle>
            <AlertDialogDescription>
              Your links start
              {/* On a line of its own, so the text doesn't jump as the handle grows. */}
              <span className="block break-all font-medium text-foreground">
                {typeof window === 'undefined' ? 'farty.fm' : window.location.host}/@
                {handle || '…'}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-1.5">
            <div className="relative">
              <span
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-base text-muted-foreground"
                aria-hidden
              >
                @
              </span>
              <Input
                aria-label="Handle"
                aria-describedby="handle-message"
                aria-invalid={problem !== null}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                maxLength={HANDLE_MAX + 1}
                value={typed}
                onChange={event => setTyped(event.target.value)}
                className="h-11 pl-7 text-base"
              />
            </div>
            <p
              id="handle-message"
              aria-live="polite"
              className={cn(
                'text-sm',
                problem || failed ? 'text-destructive' : 'text-muted-foreground'
              )}
            >
              {failed ? "Couldn't save your handle. Check your connection and try again." : message}
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 text-base">Cancel</AlertDialogCancel>
            <Button type="submit" className="h-11 text-base" disabled={!free || saving}>
              {action}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}
