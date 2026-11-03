import { announceQueued, itemKey } from './outbox'
import { deleteItem, download, holds, queue, withDb } from './recording-store'
import type { Toot } from './toot'

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

export class TootAudioMissing extends Error {
  constructor(id: string) {
    super(`No audio for Toot ${id}`)
    this.name = 'TootAudioMissing'
  }
}

export async function loadTootAudio(id: string): Promise<ArrayBuffer> {
  const wav = await withDb(database => database.get('tootAudio', id))
  if (wav) return wav
  const downloaded = await download('toots', id)
  if (downloaded instanceof ArrayBuffer) return downloaded
  if (downloaded === 'missing') throw new TootAudioMissing(id)
  throw new Error(`Toot ${id}'s audio didn't download`)
}

export async function renameToot(id: string, title: string): Promise<void> {
  const renamed = await withDb(async database => {
    const tx = database.transaction(['toots', 'outbox'], 'readwrite')
    const toots = tx.objectStore('toots')
    const outbox = tx.objectStore('outbox')
    const toot = await toots.get(id)
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

export async function deleteToot(id: string): Promise<void> {
  await deleteItem('toots', id)
}
