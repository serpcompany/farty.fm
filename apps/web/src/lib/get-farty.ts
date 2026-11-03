import { useSyncExternalStore } from 'react'
import type { RequestRefusal } from './friends'

type GetFartyStage = 'account' | 'friend' | 'home'

export type FriendOutcome = 'requested' | 'friends' | RequestRefusal | 'cancelled'

export type GetFarty = {
  friend: string | null
  add: boolean
  stage: GetFartyStage
  outcome: FriendOutcome | null
  page: string
}

const key = 'pedos.getFarty'
const listeners = new Set<() => void>()
let current: GetFarty | null | undefined

function load(): GetFarty | null {
  try {
    const kept = JSON.parse(sessionStorage.getItem(key) ?? 'null') as Partial<GetFarty> | null
    if (!kept || !['account', 'friend', 'home'].includes(kept.stage as string)) return null
    if (typeof kept.page !== 'string') return null
    return {
      friend: typeof kept.friend === 'string' ? kept.friend : null,
      add: kept.add === true,
      stage: kept.stage as GetFartyStage,
      outcome: typeof kept.outcome === 'string' ? (kept.outcome as FriendOutcome) : null,
      page: kept.page
    }
  } catch {
    return null
  }
}

function readGetFarty(): GetFarty | null {
  if (typeof window === 'undefined') return null
  if (current === undefined) current = load()
  return current
}

function set(next: GetFarty | null): void {
  current = next
  try {
    if (next) sessionStorage.setItem(key, JSON.stringify(next))
    else sessionStorage.removeItem(key)
  } catch {}
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useGetFarty(): GetFarty | null {
  return useSyncExternalStore(subscribe, readGetFarty, () => null)
}

export function startGetFarty(friend: string | null, page: string): void {
  set({ friend, add: friend !== null, stage: 'account', outcome: null, page })
}

export function offerFriend(add: boolean): void {
  const flow = readGetFarty()
  if (flow?.stage === 'account') set({ ...flow, add })
}

export function signedInAtAccountStep(): void {
  const flow = readGetFarty()
  if (flow?.stage !== 'account') return
  set({ ...flow, stage: flow.add && flow.friend !== null ? 'friend' : 'home' })
}

export function skippedAccountStep(): void {
  const flow = readGetFarty()
  if (flow?.stage === 'account') set({ ...flow, stage: 'home' })
}

export function finishFriendRequest(outcome: FriendOutcome): void {
  const flow = readGetFarty()
  if (flow?.stage === 'friend') set({ ...flow, stage: 'home', outcome })
}

export function retryFriendRequest(): void {
  const flow = readGetFarty()
  if (flow?.stage === 'home' && flow.outcome === 'failed') {
    set({ ...flow, stage: 'friend', outcome: null })
  }
}

export function leaveGetFarty(page: string): void {
  const flow = readGetFarty()
  if (flow && flow.page !== page) set(null)
}

export function endGetFarty(): void {
  set(null)
}
