import { changeSignal } from './change-signal'
import { type FartChoices, sameFartChoices } from './engine/fart-choices'
import { announceQueued } from './outbox'
import { queue, withDb } from './recording-store'

// Fart Choices (#360): for each Song the user changed in Song Creator, the farts they swapped in
// and left out, kept in this browser's `pedos` database (`fartChoices`, by Song id). Each change
// queues in the outbox with it, so a signed-in browser sends it to the account, and a guest's go
// to the account they sign in with (`library-sync.ts`), as Favorite Songs do. A guest's new
// visit clears them with the Recordings they name (`clearVisit`).

/** Every changed Song's Fart Choices in this browser, by Song id. */
export async function loadFartChoices(): Promise<Map<string, FartChoices>> {
  return withDb(async database => {
    const tx = database.transaction('fartChoices')
    const [ids, choices] = await Promise.all([tx.store.getAllKeys(), tx.store.getAll(), tx.done])
    return new Map(ids.map((id, i) => [id, choices[i]]))
  })
}

/**
 * Keeps `choices` as the Song's Fart Choices, or with null makes it automatic again, and queues it
 * for the account in the same transaction. Nothing when they already are as asked.
 */
export async function setFartChoices(songId: string, choices: FartChoices | null): Promise<void> {
  const changed = await withDb(async database => {
    // The outbox is named before the first request (`queue`).
    const tx = database.transaction(['outbox', 'fartChoices'], 'readwrite')
    const outbox = tx.objectStore('outbox')
    const store = tx.objectStore('fartChoices')
    // A retry finds the first try's write already there, and changes nothing (`withDb`).
    if (sameFartChoices((await store.get(songId)) ?? null, choices)) {
      await tx.done
      return false
    }
    await Promise.all([
      choices ? store.put(choices, songId) : store.delete(songId),
      queue(outbox, 'fartChoices', songId, choices ? 'put' : 'delete'),
      tx.done
    ])
    return true
  })
  if (!changed) return
  announceQueued()
  fartChoicesChanged()
}

const signal = changeSignal('pedos-fart-choices')

/**
 * Says the Fart Choices changed here: a change in Song Creator, or a sync that brought another
 * browser's. This tab and Farty's other tabs read them again.
 */
export const fartChoicesChanged: () => void = signal.changed

/**
 * Calls `listener` whenever the Fart Choices change, in this tab or another. Returns a function
 * that stops it.
 */
export const onFartChoicesChanged: (listener: () => void) => () => void = signal.onChanged
