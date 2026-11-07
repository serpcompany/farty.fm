'use client'

import {
  AudioLines,
  Clock,
  ListMusic,
  type LucideIcon,
  Play,
  Square,
  UserCheck,
  UserPlus,
  X
} from 'lucide-react'
import Link from 'next/link'
import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { actOnFriend, type FriendAction, type FriendState, readFriendState } from '@/lib/friends'
import { useGetFarty } from '@/lib/get-farty'
import { profilePath } from '@/lib/handle'
import { cn } from '@/lib/utils'
import { useAccount } from './account-provider'
import { FriendsUnreachable, RemoveFriendDialog, refusalMessage, useFriendRequest } from './friends'
import { useStartGetFarty } from './get-farty'
import { type HeroRoll, LetterPicture, RollBanner } from './profile-hero'
import {
  type ProfilePlayer,
  type ProfileShare,
  ShareList,
  useProfilePlayer,
  useTootRow
} from './profile-share-row'
import { Report, SharedTopBar } from './shared-recording-page'

// A profile page, `/@<handle>/` (#319, ADR 0021): what anyone sees, signed in or not, in any
// browser. A banner of the newest shared Toot's note roll, which Play plays, a picture of the
// Handle's first letter, the Handle and the friend control (#448), then the Toots and Recordings
// they've shared (#346), a tab each, newest first, each row a SoundCloud-style track that plays in
// place and opens its own page. No counts and no feed.

export type ProfilePageProps = {
  handle: string
  items: ProfileShare[]
  /** The newest shared Toot's roll, for the banner; null with no Toot shared. */
  hero: HeroRoll | null
}

/** The page's column: a phone's width, or the site header's on a computer. */
const column = 'mx-auto flex w-full max-w-md flex-1 flex-col px-4 pb-6 md:max-w-6xl md:px-8 md:pt-4'

export function ProfilePage({ handle, items, hero }: ProfilePageProps) {
  const [own, setOwn] = useState(false)
  const player = useProfilePlayer()
  const newest = (hero && items.find(item => item.path === hero.path)) ?? null

  return (
    <div className="flex flex-1 flex-col">
      <SharedTopBar friend={handle} />
      <div className={column}>
        <header data-testid="profile-hero">
          {hero && newest && <HeroBanner roll={hero} newest={newest} player={player} />}
          <div
            className={cn(
              'md:grid md:grid-cols-[11rem_minmax(0,1fr)] md:gap-7 md:px-6',
              !newest && 'pt-4'
            )}
          >
            <LetterPicture
              handle={handle}
              className={cn(
                'relative size-[92px] text-4xl ring-4 ring-background md:size-44 md:text-7xl',
                newest && '-mt-11 md:-mt-[88px]'
              )}
            />
            <div className="min-w-0 pt-3 md:pt-5">
              <h1 className="text-3xl font-bold tracking-tight break-all md:text-4xl">@{handle}</h1>
              {newest && (
                <p className="mt-1 truncate text-[15px] text-muted-foreground tabular-nums">
                  Newest Toot:{' '}
                  <Link
                    href={newest.path}
                    className="rounded-sm font-medium text-foreground outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {newest.name}
                  </Link>{' '}
                  · {newest.length}
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-2 md:max-w-md">
                {newest && <HeroPlay newest={newest} player={player} />}
                <FriendControl handle={handle} onOwn={setOwn} beside={newest !== null} />
              </div>
            </div>
          </div>
        </header>

        <Shares items={items} player={player} />

        {!own && (
          <div className="mt-7 flex justify-center">
            <Report title={`Report @${handle}?`} action={`${profilePath(handle)}report/`} />
          </div>
        )}
      </div>
    </div>
  )
}

/** The banner of the newest Toot's roll: edge to edge on a phone, a rounded card on a computer. */
function HeroBanner({
  roll,
  newest,
  player
}: {
  roll: HeroRoll
  newest: ProfileShare
  player: ProfilePlayer
}) {
  // A Toot whose Song isn't in Farty any more has no roll, so its banner is its waveform.
  const noRoll = roll.song === null && roll.catalogSong === null
  const levels = useTootRow(newest.path, noRoll)?.levels ?? null
  return (
    <RollBanner
      roll={roll}
      levels={levels}
      playing={player.playing?.path === newest.path}
      className="-mx-4 h-28 md:mx-0 md:h-[232px] md:rounded-3xl"
    />
  )
}

/** The banner's Play: the newest Toot, from its start, as its row plays it. */
function HeroPlay({ newest, player }: { newest: ProfileShare; player: ProfilePlayer }) {
  const playing = player.playing?.path === newest.path
  const PlayIcon = playing ? Square : Play
  return (
    <>
      <Button
        className={cn(block, 'flex-1 basis-36')}
        aria-label={playing ? `Stop ${newest.name}` : `Play ${newest.name}`}
        aria-pressed={playing}
        onClick={() => player.toggle(newest, 'hero')}
        data-testid="profile-hero-play"
      >
        <PlayIcon className="fill-current" aria-hidden />
        {playing ? 'Stop' : 'Play'}
      </Button>
      {player.unplayable?.path === newest.path && player.unplayable.source === 'hero' && (
        <p role="alert" className="order-last basis-full text-sm text-destructive">
          Couldn't play it. Check your connection and try again.
        </p>
      )}
    </>
  )
}

const TABS: { kind: ProfileShare['kind']; label: string; icon: LucideIcon }[] = [
  { kind: 'toots', label: 'Toots', icon: ListMusic },
  { kind: 'recordings', label: 'Recordings', icon: AudioLines }
]

/**
 * What they share, under a tab each: Toots first and open, then Recordings, as the owner decided
 * (#448). With nothing shared, no tabs.
 */
function Shares({ items, player }: { items: ProfileShare[]; player: ProfilePlayer }) {
  const [tab, setTab] = useState<ProfileShare['kind']>('toots')
  const buttons = useRef<(HTMLButtonElement | null)[]>([])

  if (items.length === 0) {
    return <p className="pt-8 text-sm text-muted-foreground">Nothing shared yet.</p>
  }

  const shown = items.filter(item => item.kind === tab)
  // The arrow keys move between the tabs, as a tab list's do.
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const at = TABS.findIndex(each => each.kind === tab)
    const next = (at + (event.key === 'ArrowLeft' ? TABS.length - 1 : 1)) % TABS.length
    setTab(TABS[next].kind)
    buttons.current[next]?.focus()
  }

  return (
    <section aria-label="Shared" className="pt-6 md:pt-8">
      <div
        role="tablist"
        aria-label="Shared"
        className="grid grid-cols-2 border-b md:flex md:gap-8"
        onKeyDown={key}
      >
        {TABS.map(({ kind, label, icon: Icon }, index) => {
          const selected = kind === tab
          return (
            <button
              key={kind}
              ref={element => {
                buttons.current[index] = element
              }}
              type="button"
              role="tab"
              id={`profile-tab-${kind}`}
              aria-selected={selected}
              aria-controls="profile-tab-panel"
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(kind)}
              className={cn(
                '-mb-px flex h-12 items-center justify-center gap-2 border-b-2 px-1 text-[15px] font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset',
                selected
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          )
        })}
      </div>
      <div
        role="tabpanel"
        id="profile-tab-panel"
        aria-labelledby={`profile-tab-${tab}`}
        className="pt-4"
      >
        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {tab === 'toots' ? 'No Toots shared yet.' : 'No Recordings shared yet.'}
          </p>
        ) : (
          <ShareList shares={shown} player={player} />
        )}
      </div>
    </section>
  )
}

const block = 'h-11 w-full gap-2 text-base'

/** Beside the banner's Play, its own share of the row; on its own, the column's width. */
const beside = 'flex-1 basis-36'

/** The friend control's notes and panels, which take the whole row. */
const wide = 'basis-full'

/** Signed out, Add friend is Get Farty, offering `handle` as a friend (#318). */
function AddFriendSignedOut({ handle, outline }: { handle: string; outline: boolean }) {
  const start = useStartGetFarty()
  return (
    <Button
      variant={outline ? 'outline' : 'default'}
      className={cn(block, beside)}
      onClick={() => start(handle)}
    >
      <UserPlus aria-hidden />
      Add friend
    </Button>
  )
}

/**
 * Add friend, and what it becomes: Requested (which can be cancelled), their request to the
 * viewer (Accept or Decline), Friends (which can be removed), or a note on the viewer's own page.
 * Signed out, Add friend is Get Farty's way in. Beside the banner's Play (`beside`), Add friend is
 * the second button, outlined.
 */
function FriendControl({
  handle,
  onOwn,
  beside: hasPlay
}: {
  handle: string
  onOwn: (own: boolean) => void
  beside: boolean
}) {
  const { account } = useAccount()
  const accountId = account.status === 'signedIn' ? account.id : null
  const [state, setState] = useState<{ accountId: string; state: FriendState } | null>(null)
  // The account whose read of the friend state failed, so the control says so and offers Retry.
  const [unreachable, setUnreachable] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const request = useFriendRequest(accountId)

  // Each result is kept with the account it was read for, so a read for an account that has since
  // signed out never shows for the next.
  const reload = useCallback(async () => {
    if (!accountId) return
    const read = await readFriendState(handle, accountId)
    setUnreachable(failed => (read === null ? accountId : failed === accountId ? null : failed))
    if (read) setState({ accountId, state: read })
  }, [accountId, handle])

  // Signed in through Get Farty, its friend request is still on its way: read once it's gone.
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
    // Gone: another device acted first. Read where things stand now.
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
    return <AddFriendSignedOut handle={handle} outline={hasPlay} />
  }
  if (!known && accountId && unreachable === accountId) {
    return (
      <div className={wide}>
        <FriendsUnreachable onRetry={() => void reload()} />
      </div>
    )
  }
  // Held at its size while it's read, so the list doesn't jump.
  if (!known) return <div className={cn('h-11', beside)} aria-hidden />
  if (known === 'own') {
    return (
      <p className={cn(wide, 'text-sm text-muted-foreground')}>
        This is your page. It lists only what you've shared. Shared pages show when and in which
        city each fart was recorded. You can turn the city off in Profile.
      </p>
    )
  }

  return (
    <div className={cn('grid gap-1.5', known === 'asked' ? wide : beside)}>
      {known === 'none' && (
        <Button
          variant={hasPlay ? 'outline' : 'default'}
          className={block}
          disabled={busy}
          onClick={() => void add()}
        >
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

/** Requested or Friends: a button whose menu has its one way back. */
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
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="secondary" className={block} disabled={disabled} />}
      >
        {icon}
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-auto">
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
