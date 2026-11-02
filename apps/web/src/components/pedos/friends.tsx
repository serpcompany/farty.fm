'use client'

import { ChevronRight, Ellipsis, UserPlus, X } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
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
import { Spinner } from '@/components/ui/spinner'
import {
  actOnFriend,
  type FriendAction,
  type Friends,
  type RequestRefusal,
  readFriends,
  requestFriend
} from '@/lib/friends'
import { HANDLE_MAX, normalizeHandle } from '@/lib/handle'
import { readHandle } from '@/lib/sharing'
import { cn } from '@/lib/utils'
import { HandleDialog, rememberHandle } from './share-recording'

// Friends (#319, ADR 0021): the Friends sections in Profile, and what a profile page's friend
// control shares with them: sending a request, which asks for the user's Handle first when they
// have none, and removing a friend, which asks first.

/** What a refused request says, about the Handle it was sent to. */
export function refusalMessage(refusal: RequestRefusal | 'cancelled', handle: string): string {
  switch (refusal) {
    case 'no_such_handle':
      return `No one on Farty has the handle @${handle}.`
    case 'own_handle':
      return "That's your own handle."
    case 'already_friends':
      return `You're already friends with @${handle}.`
    case 'already_requested':
      return `You already asked @${handle}.`
    case 'too_many_requests':
      return 'Too many friend requests right now. Try again later.'
    case 'cancelled':
      return 'Pick a handle to add friends.'
    default:
      return "Couldn't send the request. Check your connection and try again."
  }
}

export type SendResult =
  | { state: 'requested' | 'friends' }
  | { refused: RequestRefusal | 'cancelled' }

/**
 * Sends a friend request as `accountId`. Someone with no Handle yet picks one first, since whoever
 * they ask sees them by it, and the request goes once they have. `ensureHandle` asks for it ahead,
 * with `action` on its button: the user's Handle, or null when they didn't pick one or Farty
 * couldn't be reached. `dialog` is the Pick a handle dialog, to render.
 */
export function useFriendRequest(accountId: string | null): {
  send: (handle: string) => Promise<SendResult>
  ensureHandle: (action: string) => Promise<string | null>
  dialog: ReactNode
} {
  const [suggestion, setSuggestion] = useState<string | null>(null)
  // Kept once it closes, so its button doesn't change as it fades.
  const [action, setAction] = useState('Add friend')
  const picked = useRef<((handle: string | null) => void) | null>(null)

  const finish = (handle: string | null) => {
    setSuggestion(null)
    picked.current?.(handle)
    picked.current = null
  }

  const ensureHandle = async (action: string): Promise<string | null> => {
    if (!accountId) return null
    const read = await readHandle(accountId)
    if (!read) return null
    if (read.handle !== null) return read.handle
    return new Promise<string | null>(resolve => {
      picked.current = resolve
      setAction(action)
      setSuggestion(read.suggestion ?? '')
    })
  }

  const send = async (handle: string): Promise<SendResult> => {
    if (!accountId) return { refused: 'failed' }
    const sent = await requestFriend(handle, accountId)
    if (!('refused' in sent) || sent.refused !== 'no_handle') return sent
    if ((await ensureHandle('Add friend')) === null) return { refused: 'cancelled' }
    return requestFriend(handle, accountId)
  }

  const dialog = accountId ? (
    <HandleDialog
      accountId={accountId}
      suggestion={suggestion}
      action={action}
      onClose={() => finish(null)}
      onPicked={handle => {
        rememberHandle(accountId, handle)
        finish(handle)
      }}
    />
  ) : null
  return { send, ensureHandle, dialog }
}

/** "Remove @maya?": removing a friend asks first. Shows while `handle` is set. */
export function RemoveFriendDialog({
  handle,
  onClose,
  onRemove
}: {
  handle: string | null
  onClose: () => void
  onRemove: (handle: string) => void
}) {
  // Kept while it closes, so its text doesn't empty as it fades.
  const [shown, setShown] = useState(handle)
  if (handle !== null && handle !== shown) setShown(handle)
  return (
    <AlertDialog open={handle !== null} onOpenChange={open => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove @{shown}?</AlertDialogTitle>
          <AlertDialogDescription>
            You stop being friends. @{shown} isn't told.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11 text-base">Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            className="h-11 text-base"
            onClick={() => {
              if (handle) onRemove(handle)
            }}
          >
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** A short note at the foot of the screen, gone after a few seconds. */
export function useNote(): [ReactNode, (note: string | null) => void] {
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => {
    if (note === null) return
    const timer = setTimeout(() => setNote(null), 3_000)
    return () => clearTimeout(timer)
  }, [note])
  const shown = note && (
    <output
      aria-live="polite"
      className="fixed inset-x-0 bottom-24 z-50 mx-auto w-fit max-w-[calc(100%-2rem)] rounded-full bg-foreground px-4 py-2 text-center text-sm text-background shadow-lg md:top-20 md:bottom-auto"
    >
      {note}
    </output>
  )
  return [shown, setNote]
}

const header = 'px-4 pb-1.5 text-xs font-normal text-muted-foreground'
const list = 'divide-y overflow-hidden rounded-xl bg-muted/60'
const rowLink =
  'flex min-h-11 min-w-0 flex-1 items-center justify-between gap-4 py-2.5 pl-4 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset'

/**
 * Profile's friends, under Stats (#319): "Friend requests", only while someone has asked, with
 * Accept and Decline; "Friends", each friend opening their page and the requests the user sent,
 * each with ⋯ to remove or cancel; and Add friend, by Handle.
 */
export function FriendsSection({ accountId }: { accountId: string }) {
  const [friends, setFriends] = useState<Friends | null>(null)
  const [unreachable, setUnreachable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [note, setNote] = useNote()
  const request = useFriendRequest(accountId)

  const reload = useCallback(async () => {
    const read = await readFriends(accountId)
    setUnreachable(read === null)
    if (read) setFriends(read)
  }, [accountId])

  useEffect(() => {
    void reload()
  }, [reload])

  const act = async (handle: string, action: FriendAction, failure: string) => {
    setBusy(true)
    const after = await actOnFriend(handle, action, accountId)
    if (after === null) setNote(failure)
    await reload()
    setBusy(false)
  }

  if (!friends) {
    return (
      <section aria-labelledby="profile-friends" className="pt-6">
        <h2 id="profile-friends" className={header}>
          Friends
        </h2>
        {unreachable ? (
          <ul className={list}>
            <li className="flex min-h-11 items-center justify-between gap-4 py-0 pl-4">
              <span className="text-muted-foreground">Can't reach your friends right now.</span>
              <button
                type="button"
                className="min-h-11 shrink-0 px-4 font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
                onClick={() => void reload()}
              >
                Retry
              </button>
            </li>
          </ul>
        ) : (
          <div className="flex justify-center py-3">
            <Spinner />
          </div>
        )}
      </section>
    )
  }

  const none = friends.friends.length === 0 && friends.sent.length === 0
  return (
    <>
      {friends.requests.length > 0 && (
        <section aria-labelledby="profile-friend-requests" className="pt-6">
          <h2 id="profile-friend-requests" className={header}>
            Friend requests
          </h2>
          <ul className={list}>
            {friends.requests.map(handle => (
              <li
                key={handle}
                className="flex min-h-14 items-center gap-2 py-2 pr-3 pl-4"
                data-testid="friend-request"
              >
                <span className="grid min-w-0 flex-1">
                  <span className="truncate font-medium">@{handle}</span>
                  <span className="text-sm text-muted-foreground">Wants to be friends</span>
                </span>
                <Button
                  variant="outline"
                  className="h-10 px-3 text-sm"
                  disabled={busy}
                  aria-label={`Decline @${handle}`}
                  onClick={() => void act(handle, 'decline', "Couldn't decline. Try again.")}
                >
                  Decline
                </Button>
                <Button
                  className="h-10 px-3 text-sm"
                  disabled={busy}
                  aria-label={`Accept @${handle}`}
                  onClick={() => void act(handle, 'accept', "Couldn't accept. Try again.")}
                >
                  Accept
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="profile-friends" className="pt-6">
        <h2 id="profile-friends" className={header}>
          Friends
        </h2>
        <ul className={list}>
          {friends.friends.map(handle => (
            <li key={handle} className="flex items-center" data-testid="friend">
              <Link href={`/u/${handle}/`} className={rowLink}>
                <span className="truncate">@{handle}</span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
              <MoreMenu
                handle={handle}
                item="Remove friend"
                disabled={busy}
                onSelect={() => setRemoving(handle)}
              />
            </li>
          ))}
          {friends.sent.map(handle => (
            <li key={handle} className="flex items-center" data-testid="friend-sent">
              <span className="flex min-h-11 min-w-0 flex-1 items-center justify-between gap-4 py-2.5 pl-4">
                <span className="truncate">@{handle}</span>
                <span className="text-muted-foreground">Requested</span>
              </span>
              <MoreMenu
                handle={handle}
                item="Cancel request"
                disabled={busy}
                onSelect={() =>
                  void act(handle, 'cancel', "Couldn't cancel the request. Try again.")
                }
              />
            </li>
          ))}
          <li>
            <button
              type="button"
              className="flex min-h-11 w-full items-center gap-2 px-4 py-2.5 text-left font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset disabled:opacity-50"
              disabled={busy}
              onClick={async () => {
                // A Handle first, so the request can say who sent it. One dialog at a time.
                if (friends.handle !== null) return setAdding(true)
                setBusy(true)
                const handle = await request.ensureHandle('Next')
                setBusy(false)
                if (handle === null) return
                setFriends(current => current && { ...current, handle })
                setAdding(true)
              }}
            >
              <UserPlus className="size-4" aria-hidden />
              Add friend
            </button>
          </li>
        </ul>
        {none && (
          <p className="px-4 pt-1.5 text-xs text-muted-foreground">
            No friends yet. Add one by their handle, or from their page.
          </p>
        )}
      </section>

      <AddFriendDialog
        open={adding}
        own={friends.handle}
        friends={friends.friends}
        send={request.send}
        onClose={() => setAdding(false)}
        onSent={(handle, state) => {
          setAdding(false)
          setNote(
            state === 'friends'
              ? `You're now friends with @${handle}`
              : `Request sent to @${handle}`
          )
          void reload()
        }}
      />
      {request.dialog}
      <RemoveFriendDialog
        handle={removing}
        onClose={() => setRemoving(null)}
        onRemove={handle => {
          setRemoving(null)
          void act(handle, 'remove', "Couldn't remove them. Try again.")
        }}
      />
      {note}
    </>
  )
}

/** ⋯ on a friend's row: one item, Remove friend or Cancel request. */
function MoreMenu({
  handle,
  item,
  disabled,
  onSelect
}: {
  handle: string
  item: string
  disabled: boolean
  onSelect: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className="size-11 shrink-0 rounded-none"
            aria-label={`More for @${handle}`}
            disabled={disabled}
          />
        }
      >
        <Ellipsis className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto">
        <DropdownMenuItem
          variant="destructive"
          className="min-h-11 px-3 text-base"
          onClick={onSelect}
        >
          <X />
          {item}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Add a friend: their Handle, checked when sent. */
function AddFriendDialog({
  open,
  own,
  friends,
  send,
  onClose,
  onSent
}: {
  open: boolean
  own: string | null
  friends: string[]
  send: (handle: string) => Promise<SendResult>
  onClose: () => void
  onSent: (handle: string, state: 'requested' | 'friends') => void
}) {
  const [typed, setTyped] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [wasOpen, setWasOpen] = useState(open)
  // Starts empty each time it opens.
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setTyped('')
      setProblem(null)
    }
  }

  const submit = async () => {
    const handle = normalizeHandle(typed)
    if (handle === '') return setProblem('Enter a handle.')
    if (handle === own) return setProblem(refusalMessage('own_handle', handle))
    if (friends.includes(handle)) return setProblem(refusalMessage('already_friends', handle))
    setSending(true)
    setProblem(null)
    const sent = await send(handle)
    setSending(false)
    if ('state' in sent) onSent(handle, sent.state)
    else setProblem(refusalMessage(sent.refused, handle))
  }

  return (
    <AlertDialog open={open} onOpenChange={next => !next && !sending && onClose()}>
      <AlertDialogContent>
        <form
          className="grid gap-4"
          onSubmit={event => {
            event.preventDefault()
            if (!sending) void submit()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Add a friend</AlertDialogTitle>
            <AlertDialogDescription>
              Enter their handle. They get a friend request.
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
                aria-label="Their handle"
                aria-describedby="friend-message"
                aria-invalid={problem !== null}
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                placeholder="handle"
                maxLength={HANDLE_MAX + 1}
                value={typed}
                onChange={event => {
                  setTyped(event.target.value)
                  setProblem(null)
                }}
                className="h-11 pl-7 text-base"
              />
            </div>
            <p
              id="friend-message"
              aria-live="polite"
              className={cn('text-sm', problem ? 'text-destructive' : 'text-muted-foreground')}
            >
              {problem ??
                `Their handle is on their page: ${typeof window === 'undefined' ? 'farty.fm' : window.location.host}/u/handle`}
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 text-base" disabled={sending}>
              Cancel
            </AlertDialogCancel>
            <Button type="submit" className="h-11 text-base" disabled={sending}>
              {sending ? <Spinner /> : 'Send request'}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}
