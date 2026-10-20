import { db } from './recording-store'
import type { Toot } from './toot'

// Toots in IndexedDB, beside the Recordings (version 2 of the `pedos` database). As the iPhone
// app's `TootStore`: each Toot keeps its own audio, so deleting a Recording never silences it.

/** Every saved Toot, newest first. */
export async function loadToots(): Promise<Toot[]> {
  const all = await (await db()).getAll('toots')
  return all.sort((a, b) => b.createdAt - a.createdAt)
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
