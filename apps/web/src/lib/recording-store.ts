import {
  type DBSchema,
  type IDBPDatabase,
  type IDBPObjectStore,
  type IDBPTransaction,
  openDB,
  type StoreNames
} from 'idb'
import { libraryOwner } from './account'
import { getAudio } from './library-api'
import {
  announceQueued,
  itemKey,
  type Kind,
  mergeOutbox,
  type OutboxEntry,
  type OutboxOp,
  queueStamp
} from './outbox'
import type { AnalysisState, Recording } from './recordings'
import { reportError } from './telemetry/errors'
import type { Toot } from './toot'

/**
 * Recordings and Toots live in this browser, in IndexedDB (ADR 0001's local-first rule, on the
 * web). Metadata and audio are separate stores, so listing them never loads their audio. Without
 * an account they last only the visit, but for the Recordings kept from before #237 (`visit.ts`).
 * Signed in, they are the account's working copy, kept in step with it by `library-sync.ts`.
 */
export interface PedosDB extends DBSchema {
  recordings: { key: string; value: Recording }
  /** Each Recording's WAV, by Recording id. */
  audio: { key: string; value: ArrayBuffer }
  /** Since version 2. */
  toots: { key: string; value: Toot }
  /** Each Toot's own WAV, by Toot id. Since version 2. */
  tootAudio: { key: string; value: ArrayBuffer }
  /** What the account still needs from this browser (`outbox.ts`). Since version 3. */
  outbox: { key: string; value: OutboxEntry }
  /**
   * Recordings and Toots from the account whose WAV hasn't downloaded yet, by `itemKey`. Since
   * version 3.
   */
  downloads: { key: string; value: { kind: Kind; id: string } }
  /** `cursor`: the account's `cursor` as of this browser's last read. Since version 3. */
  meta: { key: string; value: number }
}

/** Every store: clearing this browser's library clears them all. */
const allStores = [
  'recordings',
  'audio',
  'toots',
  'tootAudio',
  'outbox',
  'downloads',
  'meta'
] as const

/** Where each kind's WAVs are kept. */
export const audioStore = { recordings: 'audio', toots: 'tootAudio' } as const

let opening: Promise<IDBPDatabase<PedosDB>> | null = null

/** Whether this tab's upgrade waits for Farty in another tab, which holds an older version open. */
let waiting = false
const waits = new EventTarget()

function setWaiting(value: boolean) {
  if (waiting === value) return
  waiting = value
  waits.dispatchEvent(new Event('change'))
}

/**
 * Calls `listener` now and on each change with whether the database waits for Farty in another
 * tab to close. Returns a function that stops it.
 */
export function onWaitingForOtherTabs(listener: (waiting: boolean) => void): () => void {
  const handle = () => listener(waiting)
  waits.addEventListener('change', handle)
  handle()
  return () => waits.removeEventListener('change', handle)
}

/**
 * The app's database, upgraded to version 3 (the outbox) on first open. Version 1 held Recordings
 * only, and version 2 added Toots. An upgrade keeps them, and queues each to upload, since none
 * has been (`queueEverything`).
 *
 * One connection serves the page until the browser closes it, as WebKit can while the tab sleeps
 * (#222), or it fails to open: the next call then opens a fresh one. Reads and writes go through
 * `withDb`, which also gets past a connection lost before the browser says so.
 */
export function db(): Promise<IDBPDatabase<PedosDB>> {
  if (opening) return opening
  const thisOpening: Promise<IDBPDatabase<PedosDB>> = openDB<PedosDB>('pedos', 3, {
    upgrade(database, oldVersion, _newVersion, transaction) {
      if (oldVersion < 1) {
        database.createObjectStore('recordings', { keyPath: 'id' })
        database.createObjectStore('audio')
      }
      if (oldVersion < 2) {
        database.createObjectStore('toots', { keyPath: 'id' })
        database.createObjectStore('tootAudio')
      }
      if (oldVersion < 3) {
        database.createObjectStore('outbox', { keyPath: 'key' })
        database.createObjectStore('downloads')
        database.createObjectStore('meta')
        // A failed write aborts the upgrade, and the open fails with it.
        if (oldVersion >= 1) queueEverything(transaction).catch(() => {})
      }
    },
    // An older version is open in another tab, and its code may never close it: the upgrade
    // waits until that tab closes.
    blocked() {
      setWaiting(true)
    },
    // A later version opening in another tab waits for this connection: close it, and open
    // again on the next call.
    blocking(_version, _blocked, event) {
      ;(event.target as IDBDatabase).close()
      forget(thisOpening)
    },
    // The browser closed the connection: storage cleared, or the IndexedDB server lost.
    terminated() {
      forget(thisOpening)
    }
  }).finally(() => setWaiting(false))
  opening = thisOpening
  thisOpening.catch(() => forget(thisOpening))
  return thisOpening
}

/** Drops `connection`, if it's still the page's, so the next `db()` opens a fresh one. */
function forget(connection: Promise<IDBPDatabase<PedosDB>>): void {
  if (opening === connection) opening = null
}

/**
 * Whether `error` came from a connection the browser closed or lost: an `InvalidStateError` from
 * a closed connection, or WebKit's `UnknownError`, "Connection to Indexed Database server lost.
 * Refresh the page to try again".
 */
export function connectionLost(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const { name, message } = error as { name?: unknown; message?: unknown }
  if (name === 'InvalidStateError') return true
  return (
    (name === 'UnknownError' || name === 'AbortError') &&
    typeof message === 'string' &&
    /connection|server.*lost/i.test(message)
  )
}

/**
 * Runs `work`, a read or a write, on the database. When it fails because the connection was
 * closed or lost, it runs once more on a fresh connection, so a tab left asleep still saves and
 * plays (#222). Should that lose its connection too, the failure is reported
 * (`library-connection-lost`) and thrown; any other failure is thrown as it is.
 *
 * `work` may run twice, so it does nothing outside the database. The first run may have committed
 * though the page never heard (WebKit can lose the connection between the two), so the second,
 * told it's a `retry`, finds its own write already there rather than failing on it.
 */
export async function withDb<T>(
  work: (database: IDBPDatabase<PedosDB>, retry: boolean) => Promise<T>
): Promise<T> {
  const connection = db()
  try {
    return await work(await connection, false)
  } catch (error) {
    if (!connectionLost(error)) throw error
    forget(connection)
    try {
      return await work(await db(), true)
    } catch (again) {
      if (connectionLost(again)) reportError('library-connection-lost', again)
      throw again
    }
  }
}

/** Whether `stored` holds every field of `fields`, as a write of them would have left it. */
export function holds(stored: object, fields: object): boolean {
  const kept = stored as Record<string, unknown>
  return Object.entries(fields).every(
    ([key, value]) => JSON.stringify(kept[key]) === JSON.stringify(value)
  )
}

/**
 * Queues an upload of every Recording and Toot an upgrade keeps, oldest first: before version 3
 * nothing uploaded, so none is on the account yet.
 */
async function queueEverything(
  transaction: IDBPTransaction<PedosDB, StoreNames<PedosDB>[], 'versionchange'>
): Promise<void> {
  const outbox = transaction.objectStore('outbox')
  const [recordings, toots] = await Promise.all([
    transaction.objectStore('recordings').getAll(),
    transaction.objectStore('toots').getAll()
  ])
  const items = [
    ...recordings.map(item => ({ kind: 'recordings' as const, item })),
    ...toots.map(item => ({ kind: 'toots' as const, item }))
  ]
  await Promise.all(
    items.map(({ kind, item }) =>
      outbox.put({
        key: itemKey(kind, item.id),
        kind,
        id: item.id,
        op: 'put',
        sent: false,
        queuedAt: item.createdAt,
        version: crypto.randomUUID()
      })
    )
  )
}

type OutboxStore = IDBPObjectStore<PedosDB, StoreNames<PedosDB>[], 'outbox', 'readwrite'>

/**
 * Adds `op` on a Recording or Toot to the outbox, in the transaction that makes the change, so the
 * change and its entry are written together or not at all. A write names `outbox` before its
 * first request: a store asked for once a request has aborted the transaction throws there and
 * then, leaving the requests already made, and `tx.done`, unhandled.
 */
export async function queue(
  outbox: OutboxStore,
  kind: Kind,
  id: string,
  op: OutboxOp
): Promise<void> {
  const key = itemKey(kind, id)
  const queued = await outbox.get(key)
  const next = mergeOutbox(queued, kind, id, op, queueStamp())
  if (next) await outbox.put(next)
  else if (queued) await outbox.delete(key)
}

const saved = new EventTarget()

/** Calls `listener` after each new Recording is saved. Returns a function that stops it. */
export function onRecordingSaved(listener: (recording: Recording) => void): () => void {
  const handle = (event: Event) => listener((event as CustomEvent<Recording>).detail)
  saved.addEventListener('recording-saved', handle)
  return () => saved.removeEventListener('recording-saved', handle)
}

/** Every Recording, oldest first. */
export async function loadRecordings(): Promise<Recording[]> {
  const all = await withDb(database => database.getAll('recordings'))
  return all.sort((a, b) => a.number - b.number)
}

/**
 * Saves a new Recording and its WAV audio together, numbered after the highest so far, and queues
 * its upload. A new Recording gets a random id; the Fixture Library gives its own
 * (`fixtureRecordingId`).
 */
export async function saveRecording(
  fields: Omit<Recording, 'id' | 'number' | 'createdAt' | 'analysis'>,
  wav: ArrayBuffer,
  id: string = crypto.randomUUID()
): Promise<Recording> {
  const recording = await withDb(async (database, retry) => {
    const tx = database.transaction(['recordings', 'audio', 'outbox'], 'readwrite')
    const outbox = tx.objectStore('outbox')
    if (retry) {
      // The first try's Recording, with its audio and its upload queued in the same transaction.
      const stored = await tx.objectStore('recordings').get(id)
      if (stored && holds(stored, fields)) {
        await tx.done
        return stored
      }
    }
    const existing = await tx.objectStore('recordings').getAll()
    const recording: Recording = {
      ...fields,
      id,
      number: existing.reduce((highest, r) => Math.max(highest, r.number), 0) + 1,
      createdAt: Date.now(),
      analysis: { state: 'analyzing' }
    }
    await Promise.all([
      tx.objectStore('recordings').add(recording),
      tx.objectStore('audio').add(wav, recording.id),
      queue(outbox, 'recordings', recording.id, 'put'),
      tx.done
    ])
    return recording
  })
  saved.dispatchEvent(new CustomEvent('recording-saved', { detail: recording }))
  return recording
}

export async function saveAnalysis(id: string, analysis: AnalysisState): Promise<Recording | null> {
  const updated = await withDb(async database => {
    const tx = database.transaction('recordings', 'readwrite')
    const recording = await tx.store.get(id)
    if (!recording) return null
    const updated = { ...recording, analysis }
    await Promise.all([tx.store.put(updated), tx.done])
    return updated
  })
  // A Recording uploads once its analysis is done.
  if (updated) announceQueued()
  return updated
}

/**
 * Places a Noise-like Recording on a note by ear, or takes it off with null (ADR 0015), and queues
 * the change for the account. The updated Recording, or null when it's gone.
 */
export async function placeRecording(
  id: string,
  placedPitch: number | null
): Promise<Recording | null> {
  const placed = await withDb(async database => {
    const tx = database.transaction(['recordings', 'outbox'], 'readwrite')
    const recordings = tx.objectStore('recordings')
    const outbox = tx.objectStore('outbox')
    const recording = await recordings.get(id)
    // Awaited together, so a failed write's aborted transaction is never left unhandled.
    if (!recording) {
      await tx.done
      return null
    }
    const updated: Recording = { ...recording, placedPitch }
    await Promise.all([recordings.put(updated), queue(outbox, 'recordings', id, 'place'), tx.done])
    return updated
  })
  if (placed) announceQueued()
  return placed
}

/** A Recording's WAV: this browser's, or the account's, downloaded now if it hasn't been yet. */
export async function loadAudio(id: string): Promise<ArrayBuffer> {
  const audio = await withDb(database => database.get('audio', id))
  if (audio) return audio
  const downloaded = await download('recordings', id)
  if (downloaded instanceof ArrayBuffer) return downloaded
  throw new Error(`No audio for Recording ${id}`)
}

export async function deleteRecording(id: string): Promise<void> {
  await deleteItem('recordings', id)
}

/** Deletes a Recording or Toot and its audio, and queues the delete for the account, together. */
export async function deleteItem(kind: Kind, id: string): Promise<void> {
  await withDb(async database => {
    const tx = database.transaction([kind, audioStore[kind], 'downloads', 'outbox'], 'readwrite')
    const outbox = tx.objectStore('outbox')
    await Promise.all([
      tx.objectStore(kind).delete(id),
      tx.objectStore(audioStore[kind]).delete(id),
      tx.objectStore('downloads').delete(itemKey(kind, id)),
      queue(outbox, kind, id, 'delete'),
      tx.done
    ])
  })
  announceQueued()
}

/** Deletes every Recording and Toot in this browser, with their audio and outbox, together. */
export async function clearLibrary(): Promise<void> {
  await withDb(async database => {
    const tx = database.transaction(allStores, 'readwrite')
    await Promise.all([...allStores.map(name => tx.objectStore(name).clear()), tx.done])
  })
}

/** Every Recording's id in this browser. */
export async function recordingIds(): Promise<string[]> {
  return withDb(database => database.getAllKeys('recordings'))
}

/**
 * Clears a guest's last visit (#237): every Toot, and every Recording but those `kept`, with their
 * audio and whatever waits to send or download for them, together. With `kept` null, every
 * Recording stays. Those that stay keep their outbox, so a sign-in still uploads them.
 */
export async function clearVisit(kept: ReadonlySet<string> | null): Promise<void> {
  // Every key that starts `toots:` (`itemKey`).
  const forToots = IDBKeyRange.bound(itemKey('toots', ''), itemKey('toots', '\uffff'))
  await withDb(async database => {
    const tx = database.transaction(
      ['toots', 'tootAudio', 'recordings', 'audio', 'outbox', 'downloads'],
      'readwrite'
    )
    const recordings = tx.objectStore('recordings')
    const audio = tx.objectStore('audio')
    const outbox = tx.objectStore('outbox')
    const downloads = tx.objectStore('downloads')
    const held = kept ? [...(await recordings.getAllKeys()), ...(await audio.getAllKeys())] : []
    const gone = new Set(held.filter(id => !kept?.has(id)))
    await Promise.all([
      tx.objectStore('toots').clear(),
      tx.objectStore('tootAudio').clear(),
      outbox.delete(forToots),
      downloads.delete(forToots),
      ...[...gone].flatMap(id => [
        recordings.delete(id),
        audio.delete(id),
        outbox.delete(itemKey('recordings', id)),
        downloads.delete(itemKey('recordings', id))
      ]),
      tx.done
    ])
  })
}

/**
 * What a download found: the WAV, `missing` when the account has none (or the item is gone
 * here), or `failed` when it couldn't be fetched now.
 */
export type Download = ArrayBuffer | 'missing' | 'failed'

const downloading = new Map<string, Promise<Download>>()

/**
 * Downloads a Recording's or Toot's WAV from the account, as it is kept there, if this browser
 * still waits for it. One download per item at a time.
 */
export function download(kind: Kind, id: string): Promise<Download> {
  const key = itemKey(kind, id)
  let running = downloading.get(key)
  if (!running) {
    running = fetchDownload(kind, id).finally(() => downloading.delete(key))
    downloading.set(key, running)
  }
  return running
}

async function fetchDownload(kind: Kind, id: string): Promise<Download> {
  const key = itemKey(kind, id)
  const waiting = await withDb(async database => {
    if (await database.getKey('downloads', key)) return true
    // Another tab may have stored it meanwhile.
    return (await database.get(audioStore[kind], id)) ?? ('missing' as const)
  })
  if (waiting !== true) return waiting
  // Only from the account this library is.
  let accountId: string | null = null
  try {
    accountId = libraryOwner()
  } catch {
    // Storage is blocked: a library that never syncs has nothing to download.
  }
  if (!accountId) return 'failed'
  const wav = await getAudio(kind, id, accountId)
  if (!(wav instanceof ArrayBuffer) && wav.status !== 404) return 'failed'
  return withDb(async database => {
    const tx = database.transaction([kind, audioStore[kind], 'downloads'], 'readwrite')
    // Only for an item still waiting for it: a delete or a sign-out meanwhile wins, and another
    // tab's download may have stored it.
    const [item, waits, stored] = await Promise.all([
      tx.objectStore(kind).getKey(id),
      tx.objectStore('downloads').getKey(key),
      tx.objectStore(audioStore[kind]).get(id)
    ])
    if (!item || !waits) {
      await tx.done
      return (item && stored) || 'missing'
    }
    if (!(wav instanceof ArrayBuffer)) {
      // The account has no audio for it: it's missing here too, from now on.
      await Promise.all([tx.objectStore('downloads').delete(key), tx.done])
      return 'missing'
    }
    await Promise.all([
      tx.objectStore(audioStore[kind]).put(wav, id),
      tx.objectStore('downloads').delete(key),
      tx.done
    ])
    return wav
  })
}
