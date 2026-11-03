import {
  forgetAccount,
  legacyOwner,
  readableLibraryOwner,
  readableLibraryOwnerEmail,
  setLibraryOwner
} from './account'
import { announceLibraryChange } from './library-changes'
import { pullAccountChanges } from './library-pull'
import { type Kind, type OutboxEntry, onQueued, waitsForRoom } from './outbox'
import { roomMayExist, sendOutbox } from './outbox-send'
import { adoptTakes, releaseTakes } from './pad-take'
import { clearLibrary, download, withDb } from './recording-store'

const syncLock = 'pedos-sync'

async function withSyncLock<T>(job: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) return job()
  return navigator.locks.request(syncLock, job)
}

let pulledFor: string | null = null
const pulls = new EventTarget()

function setPulled(accountId: string | null): void {
  if (pulledFor === accountId) return
  pulledFor = accountId
  pulls.dispatchEvent(new Event('change'))
}

export function libraryPulled(): string | null {
  return pulledFor
}

export function onLibraryPulled(listener: () => void): () => void {
  pulls.addEventListener('change', listener)
  return () => pulls.removeEventListener('change', listener)
}

const isFart = (entry: OutboxEntry) => entry.kind !== 'favorites'

export async function claimLibrary(accountId: string, email = ''): Promise<boolean> {
  if (!accountId) return false
  roomMayExist('recordings', 'toots')
  const current = readableLibraryOwner()
  if (current === undefined) return false
  if (current !== accountId && current !== null && current !== legacyOwner) {
    await withSyncLock(clearLibrary)
    setPulled(null)
    releaseTakes(current)
    announceLibraryChange({ reset: true })
  }
  try {
    setLibraryOwner(accountId, email)
    if (current === null || current === legacyOwner) adoptTakes(current, accountId)
    return true
  } catch {
    return false
  }
}

export async function leftByAnAccount(): Promise<boolean> {
  return (await withDb(database => database.get('meta', 'cursor'))) !== undefined
}

export async function unsavedBeforeSignIn(email: string): Promise<number> {
  const current = readableLibraryOwner()
  if (!current || current === legacyOwner) return 0
  const ownerEmail = readableLibraryOwnerEmail()
  if (ownerEmail !== null && ownerEmail === email.trim().toLowerCase()) return 0
  const queued = await withDb(database => database.getAll('outbox'))
  return queued.filter(entry => entry.op === 'put' && isFart(entry)).length
}

export async function forgetLibrary(): Promise<void> {
  await withSyncLock(async () => {
    try {
      await clearLibrary()
    } catch {
      return
    }
    setPulled(null)
    const left = readableLibraryOwner()
    if (left) releaseTakes(left)
    forgetAccount()
  })
  announceLibraryChange({ reset: true })
}

async function pullThenSend(accountId: string): Promise<boolean> {
  if (!(await pullAccountChanges(accountId))) return false
  setPulled(accountId)
  return sendOutbox(accountId)
}

export async function syncOnce(accountId: string): Promise<void> {
  await withSyncLock(async () => {
    if (readableLibraryOwner() !== accountId) return
    await pullThenSend(accountId)
  })
}

export async function downloadAll(stopped: () => boolean): Promise<void> {
  const waiting = await withDb(database => database.getAll('downloads'))
  for (const { kind, id } of waiting) {
    if (stopped()) return
    if ((await download(kind, id)) === 'failed') return
  }
}

export function startSync(accountId: string, email: string, ready: Promise<void>): () => void {
  let stopped = false
  let running = false
  let again = false
  let fetching = false
  const isStopped = () => stopped

  const fetchAll = async () => {
    if (fetching || stopped) return
    fetching = true
    try {
      await downloadAll(isStopped)
    } catch {
    } finally {
      fetching = false
    }
  }

  const run = async () => {
    if (stopped) return
    if (running) {
      again = true
      return
    }
    running = true
    try {
      do {
        again = false
        if (!stopped) await syncOnce(accountId)
      } while (again && !stopped)
    } catch {
    } finally {
      running = false
    }
    void fetchAll()
  }
  const trigger = () => void run()
  const visible = () => {
    if (document.visibilityState === 'visible') trigger()
  }

  let stopQueued = () => {}
  ready
    .then(() => (stopped ? false : claimLibrary(accountId, email)))
    .then(claimed => {
      if (!claimed || stopped) return
      stopQueued = onQueued(trigger)
      window.addEventListener('online', trigger)
      document.addEventListener('visibilitychange', visible)
      trigger()
    })
    .catch(() => {})

  return () => {
    stopped = true
    stopQueued()
    window.removeEventListener('online', trigger)
    document.removeEventListener('visibilitychange', visible)
  }
}

export type LeftBeforeSignOut = { left: number; full: number }

export async function uploadBeforeSignOut(accountId: string): Promise<LeftBeforeSignOut> {
  return withSyncLock(async () => {
    const reached = readableLibraryOwner() === accountId && (await pullThenSend(accountId))
    const queued = await withDb(database => database.getAll('outbox'))
    return { left: queued.filter(isFart).length, full: reached ? await waitingForRoom() : 0 }
  })
}

export async function waitingForRoom(kind?: Kind): Promise<number> {
  const queued = await withDb(database => database.getAll('outbox'))
  return queued.filter(entry => waitsForRoom(entry) && (!kind || entry.kind === kind)).length
}
