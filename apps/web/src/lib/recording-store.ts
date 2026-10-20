import { type DBSchema, type IDBPDatabase, openDB } from 'idb'
import type { AnalysisState, Recording } from './recordings'
import type { Toot } from './toot'

/**
 * Recordings and Toots live only in this browser, in IndexedDB (ADR 0001's local-first rule, on
 * the web). Metadata and audio are separate stores, so listing them never loads their audio.
 */
export interface PedosDB extends DBSchema {
  recordings: { key: string; value: Recording }
  /** Each Recording's WAV, by Recording id. */
  audio: { key: string; value: ArrayBuffer }
  /** Since version 2. */
  toots: { key: string; value: Toot }
  /** Each Toot's own WAV, by Toot id. Since version 2. */
  tootAudio: { key: string; value: ArrayBuffer }
}

let opening: Promise<IDBPDatabase<PedosDB>> | null = null

/**
 * The app's database, upgraded to version 2 (Toots) on first open. Version 1 held Recordings
 * only; an upgrade keeps them.
 */
export function db(): Promise<IDBPDatabase<PedosDB>> {
  opening ??= openDB<PedosDB>('pedos', 2, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        database.createObjectStore('recordings', { keyPath: 'id' })
        database.createObjectStore('audio')
      }
      if (oldVersion < 2) {
        database.createObjectStore('toots', { keyPath: 'id' })
        database.createObjectStore('tootAudio')
      }
    },
    // A later version opening in another tab waits for this connection: close it, and open
    // again on the next call.
    blocking(_version, _blocked, event) {
      ;(event.target as IDBDatabase).close()
      opening = null
    }
  })
  return opening
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
  const all = await (await db()).getAll('recordings')
  return all.sort((a, b) => a.number - b.number)
}

/**
 * Saves a new Recording and its WAV audio together, numbered after the highest so far. A new
 * Recording gets a random id; the Fixture Library gives its own (`fixtureRecordingId`).
 */
export async function saveRecording(
  fields: Omit<Recording, 'id' | 'number' | 'createdAt' | 'analysis'>,
  wav: ArrayBuffer,
  id: string = crypto.randomUUID()
): Promise<Recording> {
  const database = await db()
  const tx = database.transaction(['recordings', 'audio'], 'readwrite')
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
    tx.done
  ])
  saved.dispatchEvent(new CustomEvent('recording-saved', { detail: recording }))
  return recording
}

export async function saveAnalysis(id: string, analysis: AnalysisState): Promise<Recording | null> {
  const database = await db()
  const tx = database.transaction('recordings', 'readwrite')
  const recording = await tx.store.get(id)
  if (!recording) return null
  const updated = { ...recording, analysis }
  await Promise.all([tx.store.put(updated), tx.done])
  return updated
}

export async function loadAudio(id: string): Promise<ArrayBuffer> {
  const audio = await (await db()).get('audio', id)
  if (!audio) throw new Error(`No audio for Recording ${id}`)
  return audio
}

export async function deleteRecording(id: string): Promise<void> {
  const database = await db()
  const tx = database.transaction(['recordings', 'audio'], 'readwrite')
  await Promise.all([
    tx.objectStore('recordings').delete(id),
    tx.objectStore('audio').delete(id),
    tx.done
  ])
}
