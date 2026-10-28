import {
  forgetAccount,
  legacyOwner,
  readableLibraryOwner,
  readableLibraryOwnerEmail,
  setLibraryOwner
} from './account'
import { announceLibraryChange } from './library-changes'
import { pullAccountChanges } from './library-pull'
import { onQueued } from './outbox'
import { sendOutbox } from './outbox-send'
import { clearLibrary, download, withDb } from './recording-store'

export { onLibraryChanged } from './library-changes'

const syncLock = 'pedos-sync'

async function withSyncLock<T>(job: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) return job()
  return navigator.locks.request(syncLock, job)
}

export async function claimLibrary(accountId: string, email = ''): Promise<boolean> {
  if (!accountId) return false
  const current = readableLibraryOwner()
  if (current === undefined) return false
  if (current !== accountId && current !== null && current !== legacyOwner) {
    await withSyncLock(clearLibrary)
    announceLibraryChange({ reset: true })
  }
  try {
    setLibraryOwner(accountId, email)
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
  return queued.filter(entry => entry.op === 'put').length
}

export async function forgetLibrary(): Promise<void> {
  await withSyncLock(async () => {
    try {
      await clearLibrary()
    } catch {
      return
    }
    forgetAccount()
  })
  announceLibraryChange({ reset: true })
}

async function pullThenSend(accountId: string): Promise<void> {
  if (await pullAccountChanges(accountId)) await sendOutbox(accountId)
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

export async function uploadBeforeSignOut(accountId: string): Promise<number> {
  return withSyncLock(async () => {
    if (readableLibraryOwner() === accountId) await pullThenSend(accountId)
    return withDb(database => database.count('outbox'))
  })
}
