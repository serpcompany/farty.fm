import { type DBSchema, type IDBPDatabase, openDB } from 'idb'
import type { AnalysisState, Recording } from './recordings'

/**
 * Recordings live only in this browser, in IndexedDB (ADR 0001's local-first rule, on the web).
 * Metadata and audio are separate stores, so listing Recordings never loads their audio.
 */
interface PedosDB extends DBSchema {
  recordings: { key: string; value: Recording }
  audio: { key: string; value: ArrayBuffer }
}

let opening: Promise<IDBPDatabase<PedosDB>> | null = null

function db(): Promise<IDBPDatabase<PedosDB>> {
  opening ??= openDB<PedosDB>('pedos', 1, {
    upgrade(database) {
      database.createObjectStore('recordings', { keyPath: 'id' })
      database.createObjectStore('audio')
    }
  })
  return opening
}

/** Every Recording, oldest first. */
export async function loadRecordings(): Promise<Recording[]> {
  const all = await (await db()).getAll('recordings')
  return all.sort((a, b) => a.number - b.number)
}

/** Saves a new Recording and its WAV audio together, numbered after the highest so far. */
export async function saveRecording(
  fields: Omit<Recording, 'id' | 'number' | 'createdAt' | 'analysis'>,
  wav: ArrayBuffer
): Promise<Recording> {
  const database = await db()
  const tx = database.transaction(['recordings', 'audio'], 'readwrite')
  const existing = await tx.objectStore('recordings').getAll()
  const recording: Recording = {
    ...fields,
    id: crypto.randomUUID(),
    number: existing.reduce((highest, r) => Math.max(highest, r.number), 0) + 1,
    createdAt: Date.now(),
    analysis: { state: 'analyzing' }
  }
  await Promise.all([
    tx.objectStore('recordings').add(recording),
    tx.objectStore('audio').add(wav, recording.id),
    tx.done
  ])
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
