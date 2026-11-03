import { announceQueued } from './outbox'
import { queue, withDb } from './recording-store'

export async function loadFavorites(): Promise<string[]> {
  return withDb(database => database.getAllKeys('favorites'))
}

export async function setFavorite(songId: string, on: boolean): Promise<void> {
  const changed = await withDb(async database => {
    const tx = database.transaction(['outbox', 'favorites'], 'readwrite')
    const outbox = tx.objectStore('outbox')
    const favorites = tx.objectStore('favorites')
    if (((await favorites.getKey(songId)) !== undefined) === on) {
      await tx.done
      return false
    }
    await Promise.all([
      on ? favorites.put(Date.now(), songId) : favorites.delete(songId),
      queue(outbox, 'favorites', songId, on ? 'put' : 'delete'),
      tx.done
    ])
    return true
  })
  if (!changed) return
  announceQueued()
  favoritesChanged()
}

const changes = new EventTarget()
const channelName = 'pedos-favorites'
const thisPage = typeof crypto === 'undefined' ? '' : crypto.randomUUID()

export function favoritesChanged(): void {
  changes.dispatchEvent(new Event('change'))
  try {
    const channel = new BroadcastChannel(channelName)
    channel.postMessage(thisPage)
    channel.close()
  } catch {}
}

export function onFavoritesChanged(listener: () => void): () => void {
  changes.addEventListener('change', listener)
  let others: BroadcastChannel | null = null
  try {
    others = new BroadcastChannel(channelName)
    others.onmessage = ({ data }: MessageEvent<string>) => {
      if (data !== thisPage) listener()
    }
  } catch {}
  return () => {
    changes.removeEventListener('change', listener)
    others?.close()
  }
}
