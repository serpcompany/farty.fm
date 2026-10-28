import { type Account, readSession } from './account'
import { claimLibrary, leftByAnAccount } from './library-sync'
import { clearLibrary, clearToots } from './recording-store'

const visitKey = 'pedos.visit'
const openedKey = 'pedos.opened'
const openLock = 'pedos-open'

export type OpenFacts = {
  account: Account
  firstOpen: boolean
  otherTabOpen: boolean
}

export function clearsOnOpen(facts: OpenFacts): boolean {
  return facts.account.status === 'signedOut' && !facts.firstOpen && !facts.otherTabOpen
}

let opening: { account: Promise<Account>; library: Promise<void> } | null = null

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
    const reloadOrUnknown = hasFlag(() => sessionStorage, visitKey, true)
    if (reloadOrUnknown) return
    const facts: OpenFacts = {
      account: await account,
      firstOpen: !hasFlag(() => localStorage, openedKey, false),
      otherTabOpen: await anotherTabOpen()
    }
    if (clearsOnOpen(facts)) await ((await leftByAnAccount()) ? clearLibrary() : clearToots())
    if (facts.account.status === 'signedOut') setFlag(() => localStorage, openedKey)
    setFlag(() => sessionStorage, visitKey)
  } catch {
  } finally {
    holdOpen()
  }
}

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
  } catch {}
}

async function anotherTabOpen(): Promise<boolean> {
  try {
    const { held = [] } = (await navigator.locks?.query()) ?? {}
    return held.some(lock => lock.name === openLock)
  } catch {
    return false
  }
}

function holdOpen(): void {
  navigator.locks
    ?.request(openLock, { mode: 'shared' }, () => new Promise<never>(() => {}))
    .catch(() => {})
}
