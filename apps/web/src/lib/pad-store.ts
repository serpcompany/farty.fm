import type { AssignedPads } from './pads'
import { withDb } from './recording-store'

export async function loadPads(): Promise<Map<number, string>> {
  return withDb(async database => {
    const tx = database.transaction('pads')
    const [keys, ids] = await Promise.all([tx.store.getAllKeys(), tx.store.getAll(), tx.done])
    return new Map(keys.map((pad, i) => [pad, ids[i]]))
  })
}

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
