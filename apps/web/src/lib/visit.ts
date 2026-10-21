import { type Account, readSession } from './account'
import { claimLibrary } from './library-sync'
import { clearLibrary } from './recording-store'

// Guests keep nothing beyond the visit (owner, 2026-10-21, #150). Without an account, Recordings
// and Toots last until Pedos closes: they survive a reload in the same tab, and the next open
// clears them before anything shows. IndexedDB stays the working copy, since sessionStorage is too
// small for audio; a sessionStorage flag says this tab's visit has started. Signed in, the
// browser's copy is the account's, and stays, also once the session has ended (`expired`).

/** sessionStorage: this tab's visit has started, so opening again is a reload. */
const visitKey = 'pedos.visit'
/**
 * localStorage: a guest's visit has opened in this browser since guests keep nothing, with the
 * session read as signed out. Before that, what a browser holds counts as this visit's (#150): the
 * next visit clears it.
 */
const openedKey = 'pedos.opened'
/** A Web Lock each open Pedos tab holds, so a new tab doesn't clear another tab's visit. */
const openLock = 'pedos-open'

/** What a new visit knows as it opens. A reload never clears (`startVisit`). */
export type OpenFacts = {
  account: Account
  /** The first open since guests keep nothing. */
  firstOpen: boolean
  /** Pedos is open in another tab, and this visit is that one's too. */
  otherTabOpen: boolean
}

/**
 * Whether a new visit clears this browser's Recordings and Toots: a guest's. Only a session that
 * reads as signed out clears: offline, with sign-in unreachable, or `expired` (a browser that was
 * signed in), nothing does.
 */
export function clearsOnOpen(facts: OpenFacts): boolean {
  return facts.account.status === 'signedOut' && !facts.firstOpen && !facts.otherTabOpen
}

let opening: { account: Promise<Account>; library: Promise<void> } | null = null

/**
 * Starts this page's visit, once: reads the session (which renews it) and, for a guest's new
 * visit, clears the last one's Recordings and Toots. Signed in, the library becomes the account's
 * (`claimLibrary`): another account's is cleared first. `library` resolves once they can be
 * loaded.
 */
export function openVisit(): { account: Promise<Account>; library: Promise<void> } {
  if (!opening) {
    const account = readSession()
    opening = { account, library: startVisit(account).then(() => claimOnOpen(account)) }
  }
  return opening
}

async function claimOnOpen(account: Promise<Account>): Promise<void> {
  const read = await account
  if (read.status === 'signedIn') await claimLibrary(read.id, read.email).catch(() => false)
}

async function startVisit(account: Promise<Account>): Promise<void> {
  try {
    // A reload continues this tab's visit. With storage blocked, Pedos can't tell a reload from a
    // new visit, so it clears nothing.
    if (hasFlag(() => sessionStorage, visitKey, true)) return
    const facts: OpenFacts = {
      account: await account,
      firstOpen: !hasFlag(() => localStorage, openedKey, false),
      otherTabOpen: await anotherTabOpen()
    }
    if (clearsOnOpen(facts)) await clearLibrary()
    // The first open's grace is spent only on an open that reads as a guest's, where the step and
    // Profile say farts go at the end of the visit. Offline or unreachable, it waits for the next.
    if (facts.account.status === 'signedOut') setFlag(() => localStorage, openedKey)
    setFlag(() => sessionStorage, visitKey)
  } catch {
    // A clear that failed leaves the last visit's farts. Pedos still opens.
  } finally {
    holdOpen()
  }
}

/** Whether `key` is set, or `blocked` when the storage can't be read. */
function hasFlag(storage: () => Storage, key: string, blocked: boolean): boolean {
  try {
    return storage().getItem(key) !== null
  } catch {
    return blocked
  }
}

function setFlag(storage: () => Storage, key: string): void {
  try {
    storage().setItem(key, '1')
  } catch {
    // Nothing to remember it in.
  }
}

async function anotherTabOpen(): Promise<boolean> {
  try {
    const { held = [] } = (await navigator.locks?.query()) ?? {}
    return held.some(lock => lock.name === openLock)
  } catch {
    return false
  }
}

/** Holds `openLock` until this page closes. */
function holdOpen(): void {
  navigator.locks
    ?.request(openLock, { mode: 'shared' }, () => new Promise<never>(() => {}))
    .catch(() => {})
}
