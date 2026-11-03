'use client'

import { ChevronRight, Ellipsis, UserPlus } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { actOnFriend, type FriendAction, type Friends, readFriends } from '@/lib/friends'
import { useAccount } from './account-provider'
import { AddFriendDialog } from './add-friend-dialog'
import { RemoveFriendDialog, useFriendRequest } from './friends'
import { useNote } from './note'
import { OneActionMenu } from './one-action-menu'
import { UnreachableRow } from './unreachable-row'

const header = 'px-4 pb-1.5 text-xs font-normal text-muted-foreground'
const list = 'divide-y overflow-hidden rounded-xl bg-muted/60'
const rowLink =
  'flex min-h-11 min-w-0 flex-1 items-center justify-between gap-4 py-2.5 pl-4 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset'

export function ProfileFriends() {
  const { account } = useAccount()
  if (account.status !== 'signedIn') return null
  return <FriendsSection key={account.id} accountId={account.id} />
}

type Act = (handle: string, action: FriendAction, failure: string) => Promise<void>

function FriendsSection({ accountId }: { accountId: string }) {
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

  const act: Act = async (handle, action, failure) => {
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
          <UnreachableRow what="your friends" onRetry={() => void reload()} />
        ) : (
          <div className="flex justify-center py-3">
            <Spinner />
          </div>
        )}
      </section>
    )
  }

  const addFriend = async () => {
    if (friends.handle !== null) return setAdding(true)
    setBusy(true)
    const handle = await request.ensureHandle('Next')
    setBusy(false)
    if (handle === null) return
    setFriends(current => current && { ...current, handle })
    setAdding(true)
  }

  const none = friends.friends.length === 0 && friends.sent.length === 0
  return (
    <>
      <FriendRequests requests={friends.requests} busy={busy} act={act} />

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
              onClick={() => void addFriend()}
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

function FriendRequests({ requests, busy, act }: { requests: string[]; busy: boolean; act: Act }) {
  if (requests.length === 0) return null
  return (
    <section aria-labelledby="profile-friend-requests" className="pt-6">
      <h2 id="profile-friend-requests" className={header}>
        Friend requests
      </h2>
      <ul className={list}>
        {requests.map(handle => (
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
  )
}

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
    <OneActionMenu
      trigger={
        <Button
          variant="ghost"
          className="size-11 shrink-0 rounded-none"
          aria-label={`More for @${handle}`}
          disabled={disabled}
        />
      }
      align="end"
      item={item}
      onSelect={onSelect}
    >
      <Ellipsis className="size-5" />
    </OneActionMenu>
  )
}
