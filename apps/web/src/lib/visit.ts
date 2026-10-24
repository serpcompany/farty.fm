import { type Account, readSession } from './account'
import { claimLibrary, leftByAnAccount } from './library-sync'
import { clearLibrary, clearToots } from './recording-store'

// A guest keeps their Recordings, and their Toots last only the visit. Guests kept nothing beyond
// the visit (owner, 2026-10-21, #150) until the owner said to "definitely fix the losing of
// recordings" (2026-10-25, #203): a guest's Recordings now outlast closing Farty, an installed one
// offline included. Toots keep the old rule: they survive a reload in the same tab, and the next
// open clears them before anything shows. IndexedDB is the working copy, since sessionStorage is
// too small for audio; a sessionStorage flag says this tab's visit has started. Signed in, the
// browser's copy is the account's, and stays, also once the session has ended (`expired`). Sign
// out clears it all (`forgetLibrary`), so a guest's library holds only what was made here as one;
// one an account left anyway, from before #203, a guest's next visit clears whole.

/** sessionStorage: this tab's visit has started, so opening again is a reload. */
const visitKey = 'pedos.visit'
/**
 * localStorage: a guest's visit has opened in this browser since a guest's Toots last only the
 * visit, with the session read as signed out. Before that, the Toots a browser holds count as this
 * visit's (#150): the next visit clears them.
 */
const openedKey = 'pedos.opened'
/** A Web Lock each open Farty tab holds, so a new tab doesn't clear another tab's Toots. */
const openLock = 'pedos-open'

/** What a new visit knows as it opens. A reload never clears (`startVisit`). */
export type OpenFacts = {
  account: Account
  /** The first open since a guest's Toots last only the visit. */
  firstOpen: boolean
  /** Farty is open in another tab, and this visit is that one's too. */
  otherTabOpen: boolean
}

/**
 * Whether a new visit clears this browser's Toots: a guest's. A guest's Recordings never clear
 * (#203). Only a session that reads as signed out clears: offline, with sign-in unreachable, or
 * `expired` (a browser that was signed in), nothing does.
 */
export function clearsOnOpen(facts: OpenFacts): boolean {
  return facts.account.status === 'signedOut' && !facts.firstOpen && !facts.otherTabOpen
}

let opening: { account: Promise<Account>; library: Promise<void> } | null = null

/**
 * Starts this page's visit, once: reads the session (which renews it) and, for a guest's new
 * visit, clears the last one's Toots, keeping the Recordings. Signed in, the library becomes the
 * account's (`claimLibrary`): a guest's Recordings join it, and another account's library is
 * cleared first. `library` resolves once they can be loaded.
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
    // A reload continues this tab's visit. With storage blocked, Farty can't tell a reload from a
    // new visit, so it clears nothing.
    if (hasFlag(() => sessionStorage, visitKey, true)) return
    const facts: OpenFacts = {
      account: await account,
      firstOpen: !hasFlag(() => localStorage, openedKey, false),
      otherTabOpen: await anotherTabOpen()
    }
    if (clearsOnOpen(facts)) await ((await leftByAnAccount()) ? clearLibrary() : clearToots())
    // The first open's grace is spent only on an open that reads as a guest's, where the step and
    // Profile say Toots go at the end of the visit. Offline or unreachable, it waits for the next.
    if (facts.account.status === 'signedOut') setFlag(() => localStorage, openedKey)
    setFlag(() => sessionStorage, visitKey)
  } catch {
    // A clear that failed leaves the last visit's Toots. Farty still opens.
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
