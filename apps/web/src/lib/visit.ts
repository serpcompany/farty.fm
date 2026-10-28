import { type Account, codeSentLately, libraryOwner, offerStepAgain, readSession } from './account'
import { claimLibrary, leftByAnAccount } from './library-sync'
import { clearLibrary, clearVisit, recordingIds } from './recording-store'

// A guest's farts last only the visit: keeping them needs a free account (owner, 2026-10-28, #237,
// ADR 0013). They survive a reload in the same tab, and the next open clears them before anything
// shows. Guests kept nothing beyond the visit (#150), then kept their Recordings (2026-10-25,
// #203); the Recordings a browser held when it first opened since #237 are still kept, and upload
// when the guest makes an account. IndexedDB is the working copy, since sessionStorage is too
// small for audio; a sessionStorage flag says this tab's visit has started. Signed in, the
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
/**
 * localStorage: the ids of the Recordings this browser held when it first opened since a guest's
 * Recordings last only the visit (#237), as JSON. A guest's new visit keeps these and clears the
 * rest.
 */
const keptKey = 'pedos.keptRecordings'
/** A Web Lock each open Farty tab holds, so a new tab doesn't clear another tab's farts. */
const openLock = 'pedos-open'

/** What a new visit knows as it opens. A reload never clears (`startVisit`). */
export type OpenFacts = {
  account: Account
  /** The first open since a guest's Toots last only the visit. */
  firstOpen: boolean
  /** Farty is open in another tab, and this visit is that one's too. */
  otherTabOpen: boolean
  /**
   * A sign-in code went out from this browser and still works (`codeSentLately`): the guest is
   * making the account that keeps these farts. A home-screen app that iOS ended while they read
   * their code in Mail may open again with empty sessionStorage, as a new visit.
   */
  signingUp: boolean
}

/**
 * Whether a new visit clears the last one's farts: a guest's. Only a session that reads as signed
 * out clears: offline, with sign-in unreachable, or `expired` (a browser that was signed in),
 * nothing does.
 */
export function clearsOnOpen(facts: OpenFacts): boolean {
  return (
    facts.account.status === 'signedOut' &&
    !facts.firstOpen &&
    !facts.otherTabOpen &&
    !facts.signingUp
  )
}

let opening: { account: Promise<Account>; library: Promise<void> } | null = null

/**
 * Starts this page's visit, once: reads the session (which renews it) and, for a guest's new
 * visit, clears the last one's farts, keeping the Recordings from before #237. Signed in, the
 * library becomes the account's (`claimLibrary`): a guest's Recordings join it, and another
 * account's library is cleared first. `library` resolves once they can be loaded.
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
    // Whatever the session reads, and on a reload too: this tab's visit may be from before #237.
    await noteKept().catch(() => {})
    // A reload continues this tab's visit. With storage blocked, Farty can't tell a reload from a
    // new visit, so it clears nothing.
    if (hasFlag(() => sessionStorage, visitKey, true)) return
    const facts: OpenFacts = {
      account: await account,
      firstOpen: !hasFlag(() => localStorage, openedKey, false),
      otherTabOpen: await anotherTabOpen(),
      signingUp: codeSentLately()
    }
    // The visit has started before its clear, so a clear that throws leaves the last visit's farts
    // for this one, and a reload keeps this visit's (the next new visit clears both).
    setFlag(() => sessionStorage, visitKey)
    // The first open's grace is spent only on an open that reads as a guest's, where the step and
    // Profile say farts go at the end of the visit. Offline or unreachable, it waits for the next.
    if (facts.account.status === 'signedOut') setFlag(() => localStorage, openedKey)
    if (clearsOnOpen(facts)) await ((await leftByAnAccount()) ? clearLibrary() : clearVisit(kept()))
  } catch {
    // A clear that failed leaves the last visit's farts. Farty still opens.
  } finally {
    holdOpen()
  }
}

/**
 * The first open since #237 notes the Recordings this browser holds as kept. If it can't read
 * them, the next open tries again. A guest who keeps some was told before #237 that Recordings
 * stay, and has most likely had the step's one offer: it offers once more, at their next Result,
 * before they lose what they make now.
 */
async function noteKept(): Promise<void> {
  if (hasFlag(() => localStorage, keptKey, true)) return
  const ids = await recordingIds()
  localStorage.setItem(keptKey, JSON.stringify(ids))
  if (ids.length > 0 && libraryOwner() === null) offerStepAgain()
}

/** The kept Recordings' ids, or null when they can't be read, and then none is cleared. */
function kept(): Set<string> | null {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(keptKey) ?? 'null')
    return Array.isArray(ids) && ids.every(id => typeof id === 'string') ? new Set(ids) : null
  } catch {
    return null
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
