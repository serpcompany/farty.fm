import { changeSignal } from './change-signal'
import { announceQueued } from './outbox'
import { queue, withDb } from './recording-store'

// Favorite Songs (#313): the catalog Songs the user marked with a heart in Compose, kept in this
// browser's `pedos` database (`favorites`, by Song id) for guests and accounts alike. Each tap
// queues in the outbox with the change, so a signed-in browser sends it to the account, and a
// guest's go to the account they sign in with (`library-sync.ts`), as their Recordings do. A
// guest's new visit keeps them (`clearVisit` leaves them), unlike a guest's farts.

/** The Favorite Songs in this browser, by Song id. */
export async function loadFavorites(): Promise<string[]> {
  return withDb(database => database.getAllKeys('favorites'))
}

/**
 * Marks the Song a Favorite Song, or takes it off with `on` false, and queues it for the account in
 * the same transaction. Nothing when it already is as asked.
 */
export async function setFavorite(songId: string, on: boolean): Promise<void> {
  const changed = await withDb(async database => {
    // The outbox is named before the first request (`queue`).
    const tx = database.transaction(['outbox', 'favorites'], 'readwrite')
    const outbox = tx.objectStore('outbox')
    const favorites = tx.objectStore('favorites')
    // A retry finds the first try's write already there, and changes nothing (`withDb`).
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

const signal = changeSignal('pedos-favorites')

/**
 * Says the Favorite Songs changed here: a tap, or a sync that brought another browser's. This tab
 * and Farty's other tabs read them again.
 */
export const favoritesChanged: () => void = signal.changed

/**
 * Calls `listener` whenever the Favorite Songs change, in this tab or another. Returns a function
 * that stops it.
 */
export const onFavoritesChanged: (listener: () => void) => () => void = signal.onChanged
