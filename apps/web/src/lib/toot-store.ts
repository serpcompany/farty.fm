import { db } from './recording-store'
import type { Toot } from './toot'

// Toots in IndexedDB, beside the Recordings (version 2 of the `pedos` database). As the iPhone
// app's `TootStore`: each Toot keeps its own audio, so deleting a Recording never silences it.

/** Every saved Toot, newest first. One whose audio is gone is marked `isAudioMissing`. */
export async function loadToots(): Promise<Toot[]> {
  const tx = (await db()).transaction(['toots', 'tootAudio'])
  const [all, withAudio] = await Promise.all([
    tx.objectStore('toots').getAll(),
    tx.objectStore('tootAudio').getAllKeys(),
    tx.done
  ])
  const kept = new Set(withAudio)
  return all
    .map(toot => (kept.has(toot.id) ? toot : { ...toot, isAudioMissing: true }))
    .sort((a, b) => b.createdAt - a.createdAt)
}

/** Saves a Toot and its WAV together. Throws if a Toot with this id is already saved. */
export async function saveToot(toot: Toot, wav: ArrayBuffer): Promise<void> {
  const database = await db()
  const tx = database.transaction(['toots', 'tootAudio'], 'readwrite')
  await Promise.all([
    tx.objectStore('toots').add(toot),
    tx.objectStore('tootAudio').add(wav, toot.id),
    tx.done
  ])
}

/** A saved Toot has no audio: the browser lost it. Any other error reading it may pass. */
export class TootAudioMissing extends Error {
  constructor(id: string) {
    super(`No audio for Toot ${id}`)
    this.name = 'TootAudioMissing'
  }
}

/** A saved Toot's WAV. Throws `TootAudioMissing` when it's gone, or the read's error. */
export async function loadTootAudio(id: string): Promise<ArrayBuffer> {
  const wav = await (await db()).get('tootAudio', id)
  if (!wav) throw new TootAudioMissing(id)
  return wav
}

/** Gives a saved Toot a new title. A Toot that's gone stays gone. */
export async function renameToot(id: string, title: string): Promise<void> {
  const tx = (await db()).transaction('toots', 'readwrite')
  // The stored copy, so what loading worked out (`isAudioMissing`) is never written.
  const toot = await tx.store.get(id)
  // Awaited together, so a failed write's aborted transaction is never left unhandled.
  if (toot) await Promise.all([tx.store.put({ ...toot, title }), tx.done])
  else await tx.done
}

/** Deletes a Toot and its audio together. */
export async function deleteToot(id: string): Promise<void> {
  const tx = (await db()).transaction(['toots', 'tootAudio'], 'readwrite')
  await Promise.all([
    tx.objectStore('toots').delete(id),
    tx.objectStore('tootAudio').delete(id),
    tx.done
  ])
}
