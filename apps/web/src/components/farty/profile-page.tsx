'use client'

import { Clock, Play, Square, UserCheck, UserPlus } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { play, stopPlayback } from '@/lib/audio/player'
import { actOnFriend, type FriendAction, type FriendState, readFriendState } from '@/lib/friends'
import { useGetFarty } from '@/lib/get-farty'
import { formattedTootDate } from '@/lib/toot'
import { useAccount } from './account-provider'
import { RemoveFriendDialog, refusalMessage, useFriendRequest } from './friends'
import { useStartGetFarty } from './get-farty'
import { OneActionMenu } from './one-action-menu'
import { Report, SharedTopBar, sharedAudio } from './shared-recording-page'
import { UnreachableRow } from './unreachable-row'

const noSubscribe = () => () => {}

const useInBrowser = () =>
  useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false
  )

type ProfilePageProps = {
  handle: string
  items: {
    kind: 'recordings' | 'toots'
    shareId: string
    path: string
    name: string
    detail: string | null
    sharedAt: number
  }[]
}

const KIND_LABEL = { recordings: 'Recording', toots: 'Toot' } as const

export function ProfilePage({ handle, items }: ProfilePageProps) {
  const [playing, setPlaying] = useState<string | null>(null)
  const [unplayable, setUnplayable] = useState(false)
  const [own, setOwn] = useState(false)
  const inBrowser = useInBrowser()

  useEffect(() => stopPlayback, [])

  const toggle = ({ shareId, path }: ProfilePageProps['items'][number]) => {
    if (playing === shareId) {
      stopPlayback()
      setPlaying(null)
      return
    }
    setPlaying(shareId)
    setUnplayable(false)
    void play(
      `shared:${shareId}`,
      sharedAudio(path, () => setUnplayable(true)),
      null,
      () => setPlaying(current => (current === shareId ? null : current))
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      <SharedTopBar friend={handle} />
      <div className="flex flex-1 flex-col px-4 pb-6">
        <h1 className="pt-3 text-3xl font-bold tracking-tight break-all">@{handle}</h1>
        <div className="mt-4">
          <FriendControl handle={handle} onOwn={setOwn} />
        </div>

        <section aria-labelledby="profile-shared" className="pt-6">
          <h2 id="profile-shared" className="px-4 pb-1.5 text-xs font-normal text-muted-foreground">
            Shared
          </h2>
          {items.length === 0 ? (
            <p className="px-4 text-sm text-muted-foreground">Nothing shared yet.</p>
          ) : (
            <ul className="divide-y overflow-hidden rounded-xl bg-muted/60">
              {items.map(item => {
                const isPlaying = playing === item.shareId
                const PlayIcon = isPlaying ? Square : Play
                const detail = [
                  KIND_LABEL[item.kind],
                  item.detail,
                  inBrowser ? formattedTootDate(item.sharedAt) : null
                ]
                  .filter(Boolean)
                  .join(' · ')
                return (
                  <li
                    key={item.shareId}
                    className="flex items-center gap-1 pl-2"
                    data-testid="profile-shared-item"
                  >
                    <button
                      type="button"
                      aria-label={isPlaying ? `Stop ${item.name}` : `Play ${item.name}`}
                      aria-pressed={isPlaying}
                      onClick={() => toggle(item)}
                      className="flex size-11 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <span className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <PlayIcon className="size-4 fill-current" aria-hidden />
                      </span>
                    </button>
                    <Link
                      href={item.path}
                      className="grid min-h-14 min-w-0 flex-1 content-center py-2 pr-4 pl-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
                    >
                      <span className="truncate font-medium">{item.name}</span>
                      <span className="truncate text-sm text-muted-foreground tabular-nums">
                        {detail}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
          {unplayable && (
            <p role="alert" className="px-4 pt-1.5 text-sm text-destructive">
              Couldn't play it. Check your connection and try again.
            </p>
          )}
        </section>

        {!own && (
          <div className="mt-7 flex justify-center">
            <Report title={`Report @${handle}?`} action={`/u/${handle}/report/`} />
          </div>
        )}
      </div>
    </div>
  )
}

const block = 'h-11 w-full gap-2 text-base'

function AddFriendSignedOut({ handle }: { handle: string }) {
  const start = useStartGetFarty()
  return (
    <Button className={block} onClick={() => start(handle)}>
      <UserPlus aria-hidden />
      Add friend
    </Button>
  )
}

function FriendControl({ handle, onOwn }: { handle: string; onOwn: (own: boolean) => void }) {
  const { account } = useAccount()
  const accountId = account.status === 'signedIn' ? account.id : null
  const [state, setState] = useState<{ accountId: string; state: FriendState } | null>(null)
  const [unreachable, setUnreachable] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const request = useFriendRequest(accountId)

  const reload = useCallback(async () => {
    if (!accountId) return
    const read = await readFriendState(handle, accountId)
    setUnreachable(failed => (read === null ? accountId : failed === accountId ? null : failed))
    if (read) setState({ accountId, state: read })
  }, [accountId, handle])

  const asking = useGetFarty()?.stage === 'friend'
  useEffect(() => {
    if (!asking) void reload()
  }, [reload, asking])

  const known = accountId && state?.accountId === accountId ? state.state : null
  useEffect(() => onOwn(known === 'own'), [known, onOwn])

  const show = (next: FriendState) => accountId && setState({ accountId, state: next })

  const act = async (action: FriendAction) => {
    if (!accountId) return
    setBusy(true)
    setProblem(null)
    const after = await actOnFriend(handle, action, accountId)
    const now = after === 'gone' ? await readFriendState(handle, accountId) : after
    setBusy(false)
    if (now) show(now)
    else setProblem("Couldn't reach Farty. Check your connection and try again.")
  }

  const add = async () => {
    setBusy(true)
    setProblem(null)
    const sent = await request.send(handle)
    setBusy(false)
    if ('state' in sent) return show(sent.state)
    if (sent.refused === 'already_requested') return show('requested')
    if (sent.refused === 'already_friends') return show('friends')
    if (sent.refused !== 'cancelled') setProblem(refusalMessage(sent.refused, handle))
  }

  if (account.status === 'signedOut' || account.status === 'expired') {
    return <AddFriendSignedOut handle={handle} />
  }
  if (!known && accountId && unreachable === accountId) {
    return <UnreachableRow what="your friends" onRetry={() => void reload()} />
  }
  if (!known) return <div className="h-11" aria-hidden />
  if (known === 'own') {
    return (
      <p className="text-sm text-muted-foreground">
        This is your page. It lists only what you've shared.
      </p>
    )
  }

  return (
    <div className="grid gap-1.5">
      {known === 'none' && (
        <Button className={block} disabled={busy} onClick={() => void add()}>
          <UserPlus aria-hidden />
          Add friend
        </Button>
      )}
      {known === 'requested' && (
        <StateMenu
          icon={<Clock aria-hidden />}
          label="Requested"
          item="Cancel request"
          disabled={busy}
          onSelect={() => void act('cancel')}
        />
      )}
      {known === 'friends' && (
        <StateMenu
          icon={<UserCheck aria-hidden />}
          label="Friends"
          item="Remove friend"
          disabled={busy}
          onSelect={() => setRemoving(true)}
        />
      )}
      {known === 'asked' && (
        <div className="grid gap-3 rounded-xl bg-muted/60 p-4">
          <p>
            <span className="font-medium">@{handle}</span> wants to be friends.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="h-11 text-base"
              disabled={busy}
              onClick={() => void act('decline')}
            >
              Decline
            </Button>
            <Button className="h-11 text-base" disabled={busy} onClick={() => void act('accept')}>
              Accept
            </Button>
          </div>
        </div>
      )}
      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
      {request.dialog}
      <RemoveFriendDialog
        handle={removing ? handle : null}
        onClose={() => setRemoving(false)}
        onRemove={() => {
          setRemoving(false)
          void act('remove')
        }}
      />
    </div>
  )
}

function StateMenu({
  icon,
  label,
  item,
  disabled,
  onSelect
}: {
  icon: ReactNode
  label: string
  item: string
  disabled: boolean
  onSelect: () => void
}) {
  return (
    <OneActionMenu
      trigger={<Button variant="secondary" className={block} disabled={disabled} />}
      align="center"
      item={item}
      onSelect={onSelect}
    >
      {icon}
      {label}
    </OneActionMenu>
  )
}
