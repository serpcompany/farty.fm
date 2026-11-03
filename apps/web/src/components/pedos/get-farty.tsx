'use client'

import { Check } from 'lucide-react'
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState
} from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { desktop } from '@/lib/desktop'
import {
  endGetFarty,
  type FriendOutcome,
  finishAccountStep,
  finishFriendRequest,
  startGetFarty,
  useGetFarty
} from '@/lib/get-farty'
import { useAccount } from './account-provider'
import { refusalMessage, useFriendRequest } from './friends'
import { InstallGuideCard } from './install-button'
import { ScanToOpen } from './lander'

// Get Farty on a shared page or a profile page (#318). On a phone: the account step, offering
// whoever shared the page as a friend, then the Home Screen steps. On a computer: the lander's QR
// code (#199), since Farty is a phone app. Where the flow is lives in `lib/get-farty.ts`.

const Start = createContext<((friend: string | null) => void) | null>(null)

/** Get Farty's tap: starts the flow, offering `friend`, or shows the QR code on a computer. */
export function useStartGetFarty(): (friend: string | null) => void {
  const start = useContext(Start)
  if (!start) throw new Error('useStartGetFarty needs a GetFartyFlow')
  return start
}

/** Runs Get Farty for the pages under it. `qrCode` is the lander's, drawn on the server. */
export function GetFartyFlow({ qrCode, children }: { qrCode: ReactNode; children: ReactNode }) {
  const { account, openStep, stepOpen } = useAccount()
  const flow = useGetFarty()
  const [scanning, setScanning] = useState(false)
  const accountId = account.status === 'signedIn' ? account.id : null
  const request = useFriendRequest(accountId)

  const start = (friend: string | null) => {
    if (window.matchMedia(desktop).matches) {
      setScanning(true)
      return
    }
    openStep()
    startGetFarty(friend)
  }

  // The account step closed, signed in or with Not now. A reload while it's open (a phone that
  // drops the tab while the person reads Mail) reopens it once the session is read.
  const stage = flow?.stage ?? null
  const settled = account.status !== 'checking'
  useEffect(() => {
    if (stage === 'account' && !stepOpen && settled) finishAccountStep(accountId !== null)
  }, [stage, stepOpen, settled, accountId])

  // Signed in with the friend ticked: the request, after Pick a handle for someone with none.
  const sending = useRef(false)
  const ask = useEffectEvent(async (friend: string) => {
    const sent = await request.send(friend)
    finishFriendRequest('state' in sent ? sent.state : sent.refused)
  })
  const friend = stage === 'friend' && accountId !== null ? (flow?.friend ?? null) : null
  const signedOut = stage === 'friend' && settled && accountId === null
  useEffect(() => {
    // A reload that finds the session gone: nothing can be sent.
    if (signedOut) {
      finishFriendRequest('failed')
      return
    }
    if (friend === null || sending.current) return
    sending.current = true
    void ask(friend).finally(() => {
      sending.current = false
    })
  }, [friend, signedOut])

  return (
    <Start value={start}>
      {children}
      {request.dialog}
      {flow?.stage === 'home' && !stepOpen && (
        <HomeScreenStep friend={flow.friend} outcome={flow.outcome} signedIn={accountId !== null} />
      )}
      <Dialog open={scanning} onOpenChange={setScanning}>
        <ScanToOpen qrCode={qrCode} />
      </Dialog>
    </Start>
  )
}

/** What the Home Screen step says about the friend request, if anything. */
function said(friend: string | null, outcome: FriendOutcome | null): string | null {
  if (friend === null || outcome === null) return null
  switch (outcome) {
    case 'requested':
    case 'already_requested':
      return `You asked @${friend} to be friends.`
    case 'friends':
    case 'already_friends':
      return `You and @${friend} are friends.`
    // Their own page, or they chose not to pick a Handle: nothing to say.
    case 'own_handle':
    case 'cancelled':
      return null
    default:
      return refusalMessage(outcome, friend)
  }
}

/**
 * Get Farty's second step: the Home Screen steps for this browser, as Profile's Get the app. Full
 * screen, as the account step before it.
 */
function HomeScreenStep({
  friend,
  outcome,
  signedIn
}: {
  friend: string | null
  outcome: FriendOutcome | null
  signedIn: boolean
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  const result = said(friend, outcome)
  const asked = outcome === 'requested' || outcome === 'already_requested'
  const friends = outcome === 'friends' || outcome === 'already_friends'

  useEffect(() => {
    const opener = document.activeElement
    heading.current?.focus()
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])

  return (
    <div
      role="dialog"
      aria-modal
      aria-labelledby="get-farty-title"
      className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] md:p-6"
    >
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 md:my-auto md:flex-none md:rounded-3xl md:border md:py-3 md:shadow-sm">
        <div className="flex flex-1 flex-col justify-center gap-6 py-6">
          {result && (
            <p
              role={asked || friends ? 'status' : 'alert'}
              className={
                asked || friends
                  ? 'flex items-center justify-center gap-1.5 text-center font-medium'
                  : 'text-center text-sm text-destructive'
              }
            >
              {(asked || friends) && <Check className="size-4 shrink-0" aria-hidden />}
              {result}
            </p>
          )}
          <h1
            ref={heading}
            id="get-farty-title"
            tabIndex={-1}
            className="text-center text-3xl font-bold tracking-tight outline-none"
          >
            Get the app
          </h1>
          <InstallGuideCard />
          {signedIn && (
            <p className="text-center text-sm text-muted-foreground">
              If Farty asks you to sign in there, use the same email.
            </p>
          )}
        </div>
        <div className="grid gap-2 pb-3">
          <Button variant="secondary" className="h-12 text-base" onClick={endGetFarty}>
            Done
          </Button>
        </div>
      </div>
    </div>
  )
}
