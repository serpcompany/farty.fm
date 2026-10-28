import { type Account, codeSentLately, libraryOwner, offerStepAgain, readSession } from './account'
import { claimLibrary, leftByAnAccount } from './library-sync'
import { clearLibrary, clearVisit, recordingIds } from './recording-store'

const visitKey = 'pedos.visit'
const openedKey = 'pedos.opened'
const keptKey = 'pedos.keptRecordings'
const openLock = 'pedos-open'

export type OpenFacts = {
  account: Account
  firstOpen: boolean
  otherTabOpen: boolean
  signingUp: boolean
}

export function clearsOnOpen(facts: OpenFacts): boolean {
  return (
    facts.account.status === 'signedOut' &&
    !facts.firstOpen &&
    !facts.otherTabOpen &&
    !facts.signingUp
  )
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
    await noteKept().catch(() => {})
    const reloadOrUnknown = hasFlag(() => sessionStorage, visitKey, true)
    if (reloadOrUnknown) return
    const facts: OpenFacts = {
      account: await account,
      firstOpen: !hasFlag(() => localStorage, openedKey, false),
      otherTabOpen: await anotherTabOpen(),
      signingUp: codeSentLately()
    }
    setFlag(() => sessionStorage, visitKey)
    if (facts.account.status === 'signedOut') setFlag(() => localStorage, openedKey)
    if (clearsOnOpen(facts)) {
      await ((await leftByAnAccount()) ? clearLibrary() : clearVisit(keptRecordings()))
    }
  } catch {
  } finally {
    holdOpen()
  }
}

async function noteKept(): Promise<void> {
  if (hasFlag(() => localStorage, keptKey, true)) return
  const ids = await recordingIds()
  localStorage.setItem(keptKey, JSON.stringify(ids))
  if (ids.length > 0 && libraryOwner() === null) offerStepAgain()
}

function keptRecordings(): Set<string> | null {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(keptKey) ?? 'null')
    return Array.isArray(ids) && ids.every(id => typeof id === 'string') ? new Set(ids) : null
  } catch {
    return null
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
