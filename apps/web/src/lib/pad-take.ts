import { legacyOwner, libraryOwner } from './account'
import { isPerformance, type Performance } from './performance'

// The Sound Pad's takes (#278), kept in this browser while they're unsaved, by Toot id: Checkout
// leaves the page, and back from it, or on the next open of the Sound Pad if the return never
// loaded, the Pad makes the same Toot again from its take, with the id it was paid for (ADR 0010,
// ADR 0017), as Song Creator makes a Song's again. Only Recording ids and times, never audio.
// Storage that can't be read keeps nothing: the take then lasts the page, and isn't paid for.
//
// Each take is whose library it was made in (`pedos.account`, or a guest's visit), and only that
// library's are read, so one browser never shows one person's take to another. A guest's new visit
// lets go of the last one's takes, and Sign out or another account's sign-in lets go of the
// account's takes that never started a Checkout. A take that started one stays for its account,
// since it may be paid for.

const KEY = 'pedos.padTakes'

/**
 * At most this many takes that never started a Checkout are kept, and as many that did: past it,
 * the oldest of its kind is let go, so a new take never pushes out one that may be paid for.
 */
export const MAX_KEPT_TAKES = 5

/**
 * A take kept across Checkout: the Toot's id and its Performance, the account whose library made
 * it (`null`, a guest's visit), and whether Save started a Checkout for it.
 */
export type KeptTake = {
  tootId: string
  performance: Performance
  account: string | null
  checkout: boolean
}

function isKeptTake(value: unknown): value is KeptTake {
  if (typeof value !== 'object' || value === null) return false
  const { tootId, performance, account, checkout } = value as Record<string, unknown>
  return (
    typeof tootId === 'string' &&
    isPerformance(performance) &&
    (account === null || typeof account === 'string') &&
    typeof checkout === 'boolean'
  )
}

/** The kept takes, oldest first, as stored. Throws when storage can't be read. */
function stored(): KeptTake[] {
  const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
  return Array.isArray(value) ? value.filter(isKeptTake) : []
}

/** Stores `takes`, oldest first. Throws when storage can't be written. */
function store(takes: KeptTake[]): void {
  if (takes.length === 0) localStorage.removeItem(KEY)
  else localStorage.setItem(KEY, JSON.stringify(takes))
}

/** The `MAX_KEPT_TAKES` newest of each kind, oldest first. */
function capped(takes: KeptTake[]): KeptTake[] {
  const newest = (checkout: boolean) =>
    new Set(takes.filter(take => take.checkout === checkout).slice(-MAX_KEPT_TAKES))
  const keeps = new Set([...newest(false), ...newest(true)])
  return takes.filter(take => keeps.has(take))
}

/** Whose library this browser is: an account's id, or null for a guest's. Throws when blocked. */
const owner = (): string | null => libraryOwner()

/** Keeps `take` as the newest, in place of the same Toot's. False when it can't be kept. */
function put(take: KeptTake): boolean {
  try {
    const takes = stored().filter(kept => kept.tootId !== take.tootId)
    takes.push(take)
    store(capped(takes))
    return true
  } catch {
    return false
  }
}

/**
 * Keeps the take made into the Toot `tootId` in this library, as the newest. False when it can't
 * be kept, such as with storage blocked or full.
 */
export function keepTake(tootId: string, performance: Performance): boolean {
  try {
    return put({ tootId, performance, account: owner(), checkout: false })
  } catch {
    return false
  }
}

/**
 * Keeps the take again before Save starts a Checkout for it, as the paying `accountId`'s. False
 * when it can't be kept: back from Checkout, it couldn't be made again, so Checkout isn't started.
 * So is a take made in another account's library, as on a shared phone whose session ended and
 * someone else signs in to pay: signing in clears that library, with the take's Recordings.
 */
export function keepForCheckout(
  tootId: string,
  performance: Performance,
  accountId: string
): boolean {
  try {
    const whose = owner()
    if (whose !== null && whose !== legacyOwner && whose !== accountId) return false
  } catch {
    return false
  }
  return put({ tootId, performance, account: accountId, checkout: true })
}

/** This library's kept takes, newest first, or none when storage can't be read. */
export function keptTakes(): KeptTake[] {
  try {
    const whose = owner()
    return stored()
      .filter(take => take.account === whose)
      .reverse()
  } catch {
    return []
  }
}

/** This library's kept take of the Toot `tootId`, or null. */
export function keptTake(tootId: string): KeptTake | null {
  return keptTakes().find(take => take.tootId === tootId) ?? null
}

/** Lets go of the takes `drops`, if any. */
function forget(drops: (take: KeptTake) => boolean): void {
  try {
    const takes = stored()
    const left = takes.filter(take => !drops(take))
    if (left.length !== takes.length) store(left)
  } catch {
    // Nothing kept to forget.
  }
}

/** Lets go of the Toot `tootId`'s kept take: it's saved, its payment is used, or it's gone. */
export function forgetTake(tootId: string): void {
  forget(take => take.tootId === tootId)
}

/**
 * Lets go of `account`'s takes (null: a guest's) that never started a Checkout, as its library
 * leaves this browser: a guest's new visit, Sign out, or another account's sign-in. Those that
 * started one stay for the account, which may have paid for them.
 */
export function releaseTakes(account: string | null): void {
  forget(take => take.account === account && !take.checkout)
}

/** A guest's library became `accountId`'s: so do its takes, as its Recordings join the account. */
export function adoptTakes(from: string | null, accountId: string): void {
  try {
    const takes = stored()
    if (!takes.some(take => take.account === from)) return
    store(takes.map(take => (take.account === from ? { ...take, account: accountId } : take)))
  } catch {
    // Nothing kept to adopt.
  }
}
