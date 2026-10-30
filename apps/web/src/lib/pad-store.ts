import type { AssignedPads } from './pads'
import { withDb } from './recording-store'

// The Sound Pad's Pads in IndexedDB, beside the Recordings (version 5 of the `pedos` database,
// #277): which Recording the user put on each Pad. This browser's only, never synced. A guest's
// new visit clears them with the rest of the last visit (`clearVisit`), and so does clearing the
// library (`clearLibrary`). Each read and write gets past a lost connection (`withDb`).

/** The Recordings the user put on Pads, by Pad. Empty until they first assign one. */
export async function loadPads(): Promise<Map<number, string>> {
  return withDb(async database => {
    const tx = database.transaction('pads')
    const [keys, ids] = await Promise.all([tx.store.getAllKeys(), tx.store.getAll(), tx.done])
    return new Map(keys.map((pad, i) => [pad, ids[i]]))
  })
}

/** Keeps `pads` as the Recordings on Pads, in place of what was kept. */
export async function savePads(pads: AssignedPads): Promise<void> {
  await withDb(async database => {
    const tx = database.transaction('pads', 'readwrite')
    await Promise.all([
      tx.store.clear(),
      ...[...pads].map(([pad, id]) => tx.store.put(id, pad)),
      tx.done
    ])
  })
}
