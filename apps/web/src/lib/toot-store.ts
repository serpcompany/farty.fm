import { announceQueued, itemKey } from './outbox'
import { deleteItem, download, holds, queue, withDb } from './recording-store'
import type { Toot } from './toot'

// Toots in IndexedDB, beside the Recordings (version 2 of the `pedos` database). As the iPhone
// app's `TootStore`: each Toot keeps its own audio, so deleting a Recording never silences it.
// Each save, rename and delete joins the outbox in the same transaction (`outbox.ts`). Each read
// and write gets past a lost connection (`withDb`).

/**
 * Every saved Toot, newest first. One whose audio is gone is marked `isAudioMissing`: one from the
 * account whose WAV hasn't downloaded yet isn't.
 */
export async function loadToots(): Promise<Toot[]> {
  const [all, withAudio, toDownload] = await withDb(async database => {
    const tx = database.transaction(['toots', 'tootAudio', 'downloads'])
    const [all, withAudio, toDownload] = await Promise.all([
      tx.objectStore('toots').getAll(),
      tx.objectStore('tootAudio').getAllKeys(),
      tx.objectStore('downloads').getAllKeys(),
      tx.done
    ])
    return [all, withAudio, toDownload] as const
  })
  const kept = new Set(withAudio)
  const coming = new Set(toDownload)
  const hasAudio = (toot: Toot) => kept.has(toot.id) || coming.has(itemKey('toots', toot.id))
  return all
    .map(toot => (hasAudio(toot) ? toot : { ...toot, isAudioMissing: true }))
    .sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * Saves a Toot and its WAV together. Throws if another Toot with this id is already saved: a
 * retry finding this one, saved by a first try the page didn't hear back from, is done (`withDb`).
 */
export async function saveToot(toot: Toot, wav: ArrayBuffer): Promise<void> {
  await withDb(async (database, retry) => {
    const tx = database.transaction(['toots', 'tootAudio', 'outbox'], 'readwrite')
    const outbox = tx.objectStore('outbox')
    if (retry) {
      const stored = await tx.objectStore('toots').get(toot.id)
      if (stored && holds(stored, toot)) {
        await tx.done
        return
      }
    }
    await Promise.all([
      tx.objectStore('toots').add(toot),
      tx.objectStore('tootAudio').add(wav, toot.id),
      queue(outbox, 'toots', toot.id, 'put'),
      tx.done
    ])
  })
  announceQueued()
}

/** A saved Toot has no audio: the browser lost it. Any other error reading it may pass. */
export class TootAudioMissing extends Error {
  constructor(id: string) {
    super(`No audio for Toot ${id}`)
    this.name = 'TootAudioMissing'
  }
}

/**
 * A saved Toot's WAV: this browser's, or the account's, downloaded now if it hasn't been yet.
 * Throws `TootAudioMissing` when it's gone, or the read's or the download's error.
 */
export async function loadTootAudio(id: string): Promise<ArrayBuffer> {
  const wav = await withDb(database => database.get('tootAudio', id))
  if (wav) return wav
  const downloaded = await download('toots', id)
  if (downloaded instanceof ArrayBuffer) return downloaded
  if (downloaded === 'missing') throw new TootAudioMissing(id)
  throw new Error(`Toot ${id}'s audio didn't download`)
}

/** Gives a saved Toot a new title, and queues the rename. A Toot that's gone stays gone. */
export async function renameToot(id: string, title: string): Promise<void> {
  const renamed = await withDb(async database => {
    const tx = database.transaction(['toots', 'outbox'], 'readwrite')
    const toots = tx.objectStore('toots')
    const outbox = tx.objectStore('outbox')
    // The stored copy, so what loading worked out (`isAudioMissing`) is never written.
    const toot = await toots.get(id)
    // Awaited together, so a failed write's aborted transaction is never left unhandled.
    if (!toot) {
      await tx.done
      return false
    }
    await Promise.all([
      toots.put({ ...toot, title }),
      queue(outbox, 'toots', id, 'rename'),
      tx.done
    ])
    return true
  })
  if (renamed) announceQueued()
}

/** Deletes a Toot and its audio together, and queues the delete. */
export async function deleteToot(id: string): Promise<void> {
  await deleteItem('toots', id)
}
