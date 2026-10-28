import {
  type DBSchema,
  type IDBPDatabase,
  type IDBPObjectStore,
  type IDBPTransaction,
  openDB,
  type StoreNames
} from 'idb'
import { readableLibraryOwner } from './account'
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

export interface PedosDB extends DBSchema {
  recordings: { key: string; value: Recording }
  audio: { key: string; value: ArrayBuffer }
  toots: { key: string; value: Toot }
  tootAudio: { key: string; value: ArrayBuffer }
  outbox: { key: string; value: OutboxEntry }
  downloads: { key: string; value: { kind: Kind; id: string } }
  meta: { key: string; value: number }
}

const allStores = [
  'recordings',
  'audio',
  'toots',
  'tootAudio',
  'outbox',
  'downloads',
  'meta'
] as const

export type LibraryDatabase = IDBPDatabase<PedosDB>

export const audioStore = { recordings: 'audio', toots: 'tootAudio' } as const

let opening: Promise<LibraryDatabase> | null = null

let waiting = false
const waits = new EventTarget()

function setWaiting(value: boolean) {
  if (waiting === value) return
  waiting = value
  waits.dispatchEvent(new Event('change'))
}

export function onWaitingForOtherTabs(listener: (waiting: boolean) => void): () => void {
  const handle = () => listener(waiting)
  waits.addEventListener('change', handle)
  handle()
  return () => waits.removeEventListener('change', handle)
}

export function db(): Promise<LibraryDatabase> {
  if (opening) return opening
  const thisOpening: Promise<LibraryDatabase> = openDB<PedosDB>('pedos', 3, {
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
        if (oldVersion >= 1) queueEverything(transaction).catch(() => {})
      }
    },
    blocked() {
      setWaiting(true)
    },
    blocking(_version, _blocked, event) {
      ;(event.target as IDBDatabase).close()
      forget(thisOpening)
    },
    terminated() {
      forget(thisOpening)
    }
  }).finally(() => setWaiting(false))
  opening = thisOpening
  thisOpening.catch(() => forget(thisOpening))
  return thisOpening
}

function forget(connection: Promise<LibraryDatabase>): void {
  if (opening === connection) opening = null
}

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

export async function withDb<T>(
  work: (database: LibraryDatabase, retry: boolean) => Promise<T>
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

export function holds(stored: object, fields: object): boolean {
  const kept = stored as Record<string, unknown>
  return Object.entries(fields).every(
    ([key, value]) => JSON.stringify(kept[key]) === JSON.stringify(value)
  )
}

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

export function onRecordingSaved(listener: (recording: Recording) => void): () => void {
  const handle = (event: Event) => listener((event as CustomEvent<Recording>).detail)
  saved.addEventListener('recording-saved', handle)
  return () => saved.removeEventListener('recording-saved', handle)
}

export async function loadRecordings(): Promise<Recording[]> {
  const all = await withDb(database => database.getAll('recordings'))
  return all.sort((a, b) => a.number - b.number)
}

export async function saveRecording(
  fields: Omit<Recording, 'id' | 'number' | 'createdAt' | 'analysis'>,
  wav: ArrayBuffer,
  id: string = crypto.randomUUID()
): Promise<Recording> {
  const recording = await withDb(async (database, retry) => {
    const tx = database.transaction(['recordings', 'audio', 'outbox'], 'readwrite')
    const outbox = tx.objectStore('outbox')
    if (retry) {
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
  if (updated) announceQueued()
  return updated
}

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

export async function clearLibrary(): Promise<void> {
  await withDb(async database => {
    const tx = database.transaction(allStores, 'readwrite')
    await Promise.all([...allStores.map(name => tx.objectStore(name).clear()), tx.done])
  })
}

export async function clearToots(): Promise<void> {
  const forToots = IDBKeyRange.bound(itemKey('toots', ''), itemKey('toots', '\uffff'))
  await withDb(async database => {
    const tx = database.transaction(['toots', 'tootAudio', 'outbox', 'downloads'], 'readwrite')
    await Promise.all([
      tx.objectStore('toots').clear(),
      tx.objectStore('tootAudio').clear(),
      tx.objectStore('outbox').delete(forToots),
      tx.objectStore('downloads').delete(forToots),
      tx.done
    ])
  })
}

export type Download = ArrayBuffer | 'missing' | 'failed'

const downloading = new Map<string, Promise<Download>>()

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
    return (await database.get(audioStore[kind], id)) ?? ('missing' as const)
  })
  if (waiting !== true) return waiting
  const accountId = readableLibraryOwner()
  if (!accountId) return 'failed'
  const wav = await getAudio(kind, id, accountId)
  if (!(wav instanceof ArrayBuffer) && wav.status !== 404) return 'failed'
  return withDb(async database => {
    const tx = database.transaction([kind, audioStore[kind], 'downloads'], 'readwrite')
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

export function savedByANewerFarty(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'VersionError'
  )
}
