import { useSyncExternalStore } from 'react'
import type { RequestRefusal } from './friends'

// Get Farty from a shared page on a phone (#318): a free account, offering whoever shared the page
// as a friend, then the Home Screen steps. The account comes first because the Home Screen app
// keeps its own storage, so the friend request is made before the person leaves the browser. Kept
// in sessionStorage, so a phone that drops the tab while the person reads their code in Mail comes
// back to the same step, with the same tick.

/**
 * - `account`: the account step is open, with "Add @friend as a friend".
 * - `friend`: signed in with it ticked: the request is on its way, after a Handle if they have none.
 * - `home`: the Home Screen steps.
 */
export type GetFartyStage = 'account' | 'friend' | 'home'

/** How the friend request went, for the Home Screen step to say. */
export type FriendOutcome = 'requested' | 'friends' | RequestRefusal | 'cancelled'

export type GetFarty = {
  /** The Handle of whoever's page it was, offered as a friend; null where there's no one. */
  friend: string | null
  /** "Add @friend as a friend" is ticked. */
  add: boolean
  stage: GetFartyStage
  outcome: FriendOutcome | null
}

const key = 'pedos.getFarty'
const listeners = new Set<() => void>()
/** The flow as last read or set; `undefined` until read from sessionStorage. */
let current: GetFarty | null | undefined

function load(): GetFarty | null {
  try {
    const kept = JSON.parse(sessionStorage.getItem(key) ?? 'null') as Partial<GetFarty> | null
    if (!kept || !['account', 'friend', 'home'].includes(kept.stage as string)) return null
    return {
      friend: typeof kept.friend === 'string' ? kept.friend : null,
      add: kept.add === true,
      stage: kept.stage as GetFartyStage,
      outcome: typeof kept.outcome === 'string' ? (kept.outcome as FriendOutcome) : null
    }
  } catch {
    return null
  }
}

/** Where the flow is in this tab, or null when it isn't running (and on the server). */
export function readGetFarty(): GetFarty | null {
  if (typeof window === 'undefined') return null
  if (current === undefined) current = load()
  return current
}

function set(next: GetFarty | null): void {
  current = next
  try {
    if (next) sessionStorage.setItem(key, JSON.stringify(next))
    else sessionStorage.removeItem(key)
  } catch {
    // Nothing to keep it in: the flow carries on in this page, but a reload ends it.
  }
  for (const listener of listeners) listener()
}

/** Calls `listener` when the flow changes. Returns a function that stops it. */
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Where Get Farty is in this tab, or null when it isn't running (and before the page runs). */
export function useGetFarty(): GetFarty | null {
  return useSyncExternalStore(subscribe, readGetFarty, () => null)
}

/** Get Farty, tapped: the account step, with `friend` offered and ticked. */
export function startGetFarty(friend: string | null): void {
  set({ friend, add: friend !== null, stage: 'account', outcome: null })
}

/** Ticks or unticks "Add @friend as a friend". */
export function offerFriend(add: boolean): void {
  const flow = readGetFarty()
  if (flow?.stage === 'account') set({ ...flow, add })
}

/** The account step closed: the friend request next if signed in with it ticked, else Home Screen. */
export function finishAccountStep(signedIn: boolean): void {
  const flow = readGetFarty()
  if (flow?.stage !== 'account') return
  const asks = signedIn && flow.add && flow.friend !== null
  set({ ...flow, stage: asks ? 'friend' : 'home' })
}

/** The friend request went (or didn't): the Home Screen steps, saying how. */
export function finishFriendRequest(outcome: FriendOutcome): void {
  const flow = readGetFarty()
  if (flow?.stage === 'friend') set({ ...flow, stage: 'home', outcome })
}

/** Done, or Not now, at the Home Screen steps. */
export function endGetFarty(): void {
  set(null)
}
