import type { IDBPDatabase } from 'idb'
import {
  forgetAccount,
  legacyOwner,
  libraryOwner,
  libraryOwnerEmail,
  setLibraryOwner
} from './account'
import * as api from './library-api'
import { itemKey, type Kind, type OutboxEntry, onQueued } from './outbox'
import { audioStore, clearLibrary, download, type PedosDB, withDb } from './recording-store'
import type { Recording } from './recordings'
import type { Toot } from './toot'

type Database = IDBPDatabase<PedosDB>

// A signed-in browser's library, kept in step with the account's (#156, the plan's §2). The
// outbox (`outbox.ts`) sends what this browser changed, and a read of the account's changes since
// the last one (`GET /api/library/?since=`) brings what other browsers did, deletes included. A
// Recording's or Toot's WAV moves as it is, in both directions: nothing re-renders it (ADR 0004).
// Everything that sends or applies runs under one Web Lock, so the tabs of a browser take turns.

/** What a sync changed in this browser's library, for the screens showing it. */
export type LibraryChange =
  /** Everything changed: load it again. */
  | { reset: true }
  | {
      reset?: false
      /** Recordings now here that weren't, or with a new number. */
      recordings: Recording[]
      /** Toots now here, or with a new title. */
      toots: Toot[]
      deleted: { recordings: string[]; toots: string[] }
    }

const changes = new EventTarget()
const channelName = 'pedos-library'
/** This page, so it skips its own changes when they come back from the other tabs' channel. */
const thisPage = typeof crypto === 'undefined' ? '' : crypto.randomUUID()
type Message = { from: string; change: LibraryChange }

function emit(change: LibraryChange): void {
  changes.dispatchEvent(new CustomEvent('change', { detail: change }))
  // The other tabs show the same library. A message posted is delivered after the close.
  try {
    const channel = new BroadcastChannel(channelName)
    channel.postMessage({ from: thisPage, change } satisfies Message)
    channel.close()
  } catch {
    // No other tab hears it; each loads the library again when it opens.
  }
}

/**
 * Calls `listener` with each change a sync makes, in this tab or another. Returns a function that
 * stops it.
 */
export function onLibraryChanged(listener: (change: LibraryChange) => void): () => void {
  const handle = (event: Event) => listener((event as CustomEvent<LibraryChange>).detail)
  changes.addEventListener('change', handle)
  let others: BroadcastChannel | null = null
  try {
    others = new BroadcastChannel(channelName)
    others.onmessage = ({ data }: MessageEvent<Message>) => {
      if (data.from !== thisPage) listener(data.change)
    }
  } catch {
    // Only this tab's changes, then.
  }
  return () => {
    changes.removeEventListener('change', handle)
    others?.close()
  }
}

const syncLock = 'pedos-sync'

/** Runs `job` while no other tab of this browser syncs, or at once without Web Locks. */
async function withSyncLock<T>(job: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) return job()
  return navigator.locks.request(syncLock, job)
}

/** The account this browser's library is, or undefined when storage is blocked. */
function owner(): string | null | undefined {
  try {
    return libraryOwner()
  } catch {
    return undefined
  }
}

/**
 * Makes this browser's library `accountId`'s (with its `email`), so it can sync: true once it is.
 * A guest's library becomes the account's, and uploads, with the Recordings a guest kept from
 * earlier visits (#203). Another account's is cleared first: it never uploads to this one, and its
 * farts not uploaded yet are lost, which the account step says before it signs in
 * (`unsavedBeforeSignIn`). With localStorage blocked Farty can't tell whose it is, so it never
 * syncs.
 */
export async function claimLibrary(accountId: string, email = ''): Promise<boolean> {
  if (!accountId) return false
  const current = owner()
  if (current === undefined) return false
  if (current !== accountId && current !== null && current !== legacyOwner) {
    await withSyncLock(clearLibrary)
    emit({ reset: true })
  }
  try {
    setLibraryOwner(accountId, email)
    return true
  } catch {
    return false
  }
}

/**
 * Whether this browser's library has read an account's changes (its `cursor`), so it's an
 * account's, also with no `pedos.account`. A guest's never has: `claimLibrary` makes it an
 * account's first. Before #203, a Sign out whose clear failed forgot the account and left its
 * library, which the next guest visit cleared; a guest's open still clears such a library whole
 * (`visit.ts`).
 */
export async function leftByAnAccount(): Promise<boolean> {
  return (await withDb(database => database.get('meta', 'cursor'))) !== undefined
}

/**
 * How many farts (Recordings and Toots) on this device haven't uploaded to the account its library
 * is, which signing in as `email` would clear (`claimLibrary`): none for a guest's library, or for
 * `email`'s own. A library whose account's email isn't known counts as another's.
 */
export async function unsavedBeforeSignIn(email: string): Promise<number> {
  const current = owner()
  if (!current || current === legacyOwner) return 0
  let ownerEmail: string | null = null
  try {
    ownerEmail = libraryOwnerEmail()
  } catch {
    // Unknown, then.
  }
  if (ownerEmail !== null && ownerEmail === email.trim().toLowerCase()) return 0
  const queued = await withDb(database => database.getAll('outbox'))
  return queued.filter(entry => entry.op === 'put').length
}

/**
 * Signs this browser out of its library: clears it, then forgets whose it was, while no sync is
 * applying anything. Farty's other tabs show it cleared too. A guest's Recordings are kept
 * (#203), so an account's library is never left here as a guest's, which a sign-in would upload
 * to another account: when the clear fails, the library stays the account's, and the next open
 * reads `expired` and offers Clear this device.
 */
export async function forgetLibrary(): Promise<void> {
  await withSyncLock(async () => {
    try {
      await clearLibrary()
    } catch {
      return
    }
    forgetAccount()
  })
  emit({ reset: true })
}

/** How a request went: on to the next, the entry refused (kept, and skipped this round), or stop. */
type Sent = 'next' | 'refused' | 'stop'

/**
 * Whether to stop sending: Farty is unreachable or busy, the session ended, or the account isn't
 * this library's.
 */
const stops = ({ status, error }: api.Answer) =>
  status === 0 ||
  status === 401 ||
  status === 403 ||
  status === 429 ||
  status >= 500 ||
  (status === 409 && error === 'wrong_account')

type Taken =
  | { entry: OutboxEntry; op: 'put'; item: Recording | Toot; wav: ArrayBuffer }
  | { entry: OutboxEntry; op: 'rename'; title: string }
  | { entry: OutboxEntry; op: 'delete' }

/**
 * The oldest entry to send, marked sent in the same transaction that reads what it sends. A
 * Recording waits for its analysis. Null when nothing is left but `skip`.
 */
function takeNext(skip: Set<string>): Promise<Taken | null> {
  return withDb(database => takeNextIn(database, skip))
}

async function takeNextIn(database: Database, skip: Set<string>): Promise<Taken | null> {
  const tx = database.transaction(
    ['outbox', 'recordings', 'audio', 'toots', 'tootAudio'],
    'readwrite'
  )
  const outbox = tx.objectStore('outbox')
  const entries = (await outbox.getAll())
    .filter(entry => !skip.has(entry.key))
    .sort((a, b) => a.queuedAt - b.queuedAt)
  for (const queued of entries) {
    const entry = { ...queued, sent: true }
    if (queued.op === 'put') {
      const [item, wav] = await Promise.all([
        tx.objectStore(queued.kind).get(queued.id),
        tx.objectStore(audioStore[queued.kind]).get(queued.id)
      ])
      if (!item || !wav) {
        // Nothing left to upload.
        await outbox.delete(queued.key)
        continue
      }
      if ('analysis' in item && item.analysis.state === 'analyzing') {
        skip.add(queued.key)
        continue
      }
      await Promise.all([outbox.put(entry), tx.done])
      return { entry, op: 'put', item, wav }
    }
    if (queued.op === 'rename') {
      const toot = await tx.objectStore('toots').get(queued.id)
      if (!toot) {
        await outbox.delete(queued.key)
        continue
      }
      await Promise.all([outbox.put(entry), tx.done])
      return { entry, op: 'rename', title: toot.title }
    }
    await Promise.all([outbox.put(entry), tx.done])
    return { entry, op: 'delete' }
  }
  await tx.done
  return null
}

/**
 * After a request for `sent` succeeded: done, unless the entry changed while it was on its way. A
 * Toot renamed during its upload is then renamed on the account (`then: 'rename'`), and a later
 * delete is sent next.
 */
function settle(sent: OutboxEntry, then: 'done' | 'rename' = 'done'): Promise<void> {
  return withDb(database => settleIn(database, sent, then))
}

async function settleIn(
  database: Database,
  sent: OutboxEntry,
  then: 'done' | 'rename'
): Promise<void> {
  const tx = database.transaction('outbox', 'readwrite')
  const now = await tx.store.get(sent.key)
  const unchanged = now?.version === sent.version
  if (!now) {
    // A sign-out or the account's delete cleared it meanwhile.
  } else if (now.op === 'delete') {
    // A delete queued during an upload or rename is sent next.
    if (sent.op === 'delete' && unchanged) await tx.store.delete(sent.key)
  } else if (sent.op === 'put') {
    // A rename during the upload joined the queued upload (`mergeOutbox`), so it's sent now.
    if (sent.kind === 'toots' && (then === 'rename' || !unchanged)) {
      await tx.store.put({ ...now, op: 'rename', sent: false, version: crypto.randomUUID() })
    } else await tx.store.delete(sent.key)
  } else if (unchanged) await tx.store.delete(sent.key)
  await tx.done
}

/** Deletes a Recording or Toot the account has deleted, and whatever this browser queued for it. */
async function deleteHere(kind: Kind, id: string): Promise<void> {
  const key = itemKey(kind, id)
  await withDb(async database => {
    const tx = database.transaction([kind, audioStore[kind], 'downloads', 'outbox'], 'readwrite')
    await Promise.all([
      tx.objectStore(kind).delete(id),
      tx.objectStore(audioStore[kind]).delete(id),
      tx.objectStore('downloads').delete(key),
      tx.objectStore('outbox').delete(key),
      tx.done
    ])
  })
  const deleted = { recordings: [] as string[], toots: [] as string[] }
  deleted[kind].push(id)
  emit({ recordings: [], toots: [], deleted })
}

async function send(taken: Taken, accountId: string): Promise<Sent> {
  const { entry } = taken
  if (taken.op === 'put') {
    const answer = await api.putItem(entry.kind, taken.item, taken.wav, accountId)
    if (stops(answer)) return 'stop'
    // 200: the account had it already, maybe with an older title.
    if (answer.status === 201 || answer.status === 200) {
      await settle(entry, answer.status === 200 ? 'rename' : 'done')
      return 'next'
    }
    if (answer.status === 410) {
      await deleteHere(entry.kind, entry.id)
      return 'next'
    }
    // At the limit, or refused: it stays here, and in the outbox.
    return 'refused'
  }
  if (taken.op === 'rename') {
    const answer = await api.renameToot(entry.id, taken.title, accountId)
    if (stops(answer)) return 'stop'
    if (answer.status === 410) await deleteHere(entry.kind, entry.id)
    // Renamed; or not on the account, or a title it refuses, which no retry changes.
    else await settle(entry)
    return 'next'
  }
  const answer = await api.deleteItem(entry.kind, entry.id, accountId)
  if (stops(answer)) return 'stop'
  // Deleted, or never on the account.
  await settle(entry)
  return 'next'
}

/**
 * Sends the outbox, oldest first, while this browser's library is `accountId`'s. True when
 * nothing it could send is left; false when it stopped (unreachable, signed out, or another
 * account's library now).
 */
async function drain(accountId: string): Promise<boolean> {
  const skip = new Set<string>()
  for (;;) {
    if (owner() !== accountId) return false
    const taken = await takeNext(skip)
    if (!taken) return true
    const sent = await send(taken, accountId)
    if (sent === 'stop') return false
    if (sent === 'refused') skip.add(taken.entry.key)
  }
}

/**
 * Reads the account's changes since this browser's last read and applies them, in one
 * transaction. What this browser still has to send wins: a Recording or Toot it's deleting stays
 * deleted, and a Toot it's uploading or renaming keeps its title. A `full` answer lists everything
 * the account has, so what's here from the account and isn't listed was deleted there. Recordings
 * not uploaded yet are numbered after the rest (`renumberWaiting`). False when nothing was read.
 */
async function pull(accountId: string): Promise<boolean> {
  const since = (await withDb(database => database.get('meta', 'cursor'))) ?? 0
  const answer = await api.getLibrary(since, accountId)
  if (!('cursor' in answer) || owner() !== accountId) return false
  const change = await withDb(database => apply(database, answer))
  const changed =
    change.recordings.length +
    change.toots.length +
    change.deleted.recordings.length +
    change.deleted.toots.length
  if (changed > 0) emit(change)
  return true
}

/** Applies what the account read (`pull`), in one transaction. What it changed here. */
async function apply(database: Database, answer: api.LibraryChanges) {
  const tx = database.transaction(
    ['recordings', 'audio', 'toots', 'tootAudio', 'downloads', 'outbox', 'meta'],
    'readwrite'
  )
  const recordings = tx.objectStore('recordings')
  const toots = tx.objectStore('toots')
  const downloads = tx.objectStore('downloads')
  const outbox = tx.objectStore('outbox')
  const pending = new Map((await outbox.getAll()).map(entry => [entry.key, entry.op]))
  const change = {
    recordings: [] as Recording[],
    toots: [] as Toot[],
    deleted: { recordings: [] as string[], toots: [] as string[] }
  }
  const remove = async (kind: Kind, id: string) => {
    const key = itemKey(kind, id)
    await Promise.all([
      tx.objectStore(kind).delete(id),
      tx.objectStore(audioStore[kind]).delete(id),
      downloads.delete(key),
      outbox.delete(key)
    ])
    change.deleted[kind].push(id)
  }

  for (const { audioBytes: _, ...recording } of answer.recordings) {
    const key = itemKey('recordings', recording.id)
    if (pending.get(key) === 'delete' || (await recordings.getKey(recording.id))) continue
    await Promise.all([
      recordings.put(recording),
      downloads.put({ kind: 'recordings', id: recording.id }, key)
    ])
    change.recordings.push(recording)
  }
  for (const { audioBytes: _, ...toot } of answer.toots) {
    const key = itemKey('toots', toot.id)
    const op = pending.get(key)
    if (op === 'delete') continue
    const here = await toots.get(toot.id)
    if (here) {
      if (op || here.title === toot.title) continue
      const renamed = { ...here, title: toot.title }
      await toots.put(renamed)
      change.toots.push(renamed)
    } else {
      await Promise.all([toots.put(toot), downloads.put({ kind: 'toots', id: toot.id }, key)])
      change.toots.push(toot)
    }
  }
  for (const kind of ['recordings', 'toots'] as const) {
    for (const id of answer.deleted[kind]) {
      if (await tx.objectStore(kind).getKey(id)) await remove(kind, id)
      else await outbox.delete(itemKey(kind, id))
    }
  }
  if (answer.full) {
    const listed = {
      recordings: new Set(answer.recordings.map(r => r.id)),
      toots: new Set(answer.toots.map(t => t.id))
    }
    for (const kind of ['recordings', 'toots'] as const) {
      for (const id of await tx.objectStore(kind).getAllKeys()) {
        if (!listed[kind].has(id) && pending.get(itemKey(kind, id)) !== 'put')
          await remove(kind, id)
      }
    }
  }
  const listed = new Set(answer.recordings.map(r => r.id))
  const waits = (r: Recording) =>
    pending.get(itemKey('recordings', r.id)) === 'put' && !listed.has(r.id)
  for (const renumbered of renumberWaiting(await recordings.getAll(), waits)) {
    await recordings.put(renumbered)
    change.recordings.push(renumbered)
  }
  await Promise.all([tx.objectStore('meta').put(answer.cursor, 'cursor'), tx.done])
  return change
}

/**
 * The Recordings `waits` says haven't uploaded, numbered after every other one, in their order:
 * none when they already come after. A Recording's number is its name on every browser, and a
 * Recording made here before the account's reached it, such as a guest's first one before signing
 * in, would share a number with one of the account's.
 */
export function renumberWaiting(
  all: Recording[],
  waits: (recording: Recording) => boolean
): Recording[] {
  const waiting = all.filter(waits).sort((a, b) => a.number - b.number)
  const highest = Math.max(0, ...all.filter(r => !waits(r)).map(r => r.number))
  if (waiting.length === 0 || waiting[0].number > highest) return []
  return waiting.map((recording, i) => ({ ...recording, number: highest + 1 + i }))
}

/**
 * Reads the account's changes, then sends the outbox, under the lock: only once the read worked,
 * so a Recording uploads numbered after the account's.
 */
async function pullThenDrain(accountId: string): Promise<void> {
  if (await pull(accountId)) await drain(accountId)
}

/**
 * One sync, while no other tab syncs: reads the account's changes, then sends the outbox. Nothing
 * while this browser's library isn't `accountId`'s.
 */
export async function syncOnce(accountId: string): Promise<void> {
  await withSyncLock(async () => {
    if (owner() !== accountId) return
    await pullThenDrain(accountId)
  })
}

/** Downloads every WAV this browser still waits for, one at a time, until one fails. */
export async function downloadAll(stopped: () => boolean): Promise<void> {
  const waiting = await withDb(database => database.getAll('downloads'))
  for (const { kind, id } of waiting) {
    if (stopped()) return
    if ((await download(kind, id)) === 'failed') return
  }
}

/**
 * Keeps this browser's library in step with `accountId`'s while the page is open: once `ready`
 * (the visit's library) and claimed, then whenever something joins the outbox, the browser comes
 * back online, or Farty comes back into view. Returns a function that stops it.
 */
export function startSync(accountId: string, email: string, ready: Promise<void>): () => void {
  let stopped = false
  let running = false
  let again = false
  let fetching = false
  const isStopped = () => stopped

  // WAVs download outside the lock, so an upload never waits for them.
  const fetchAll = async () => {
    if (fetching || stopped) return
    fetching = true
    try {
      await downloadAll(isStopped)
    } catch {
      // On demand, then (`loadAudio`, `loadTootAudio`), or at the next sync.
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
      // The next trigger tries again.
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

/**
 * Before signing out: reads the account's changes and sends what's left in the outbox, after any
 * sync already running. The number of entries still waiting: none means everything this browser
 * made is on the account.
 */
export async function uploadBeforeSignOut(accountId: string): Promise<number> {
  return withSyncLock(async () => {
    if (owner() === accountId) await pullThenDrain(accountId)
    return withDb(database => database.count('outbox'))
  })
}
