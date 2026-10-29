import type { Recording } from './recordings'
import type { Toot } from './toot'

export type LibraryChange =
  | { reset: true }
  | {
      reset?: false
      recordings: Recording[]
      toots: Toot[]
      deleted: { recordings: string[]; toots: string[] }
    }

type ItemChange = Exclude<LibraryChange, { reset: true }>

export function recordingsAfter(list: readonly Recording[], change: ItemChange): Recording[] {
  const { recordings: added, deleted } = change
  const kept = list.filter(r => !deleted.recordings.includes(r.id))
  const fresh = new Map(added.map(r => [r.id, r]))
  const merged = kept.map(r => {
    const changed = fresh.get(r.id)
    return changed ? { ...r, number: changed.number, placedPitch: changed.placedPitch } : r
  })
  const ids = new Set(kept.map(r => r.id))
  return [...merged, ...added.filter(r => !ids.has(r.id))].sort((a, b) => a.number - b.number)
}

const changes = new EventTarget()
const channelName = 'pedos-library'
const thisPage = typeof crypto === 'undefined' ? '' : crypto.randomUUID()
type Message = { from: string; change: LibraryChange }

export function announceLibraryChange(change: LibraryChange): void {
  changes.dispatchEvent(new CustomEvent('change', { detail: change }))
  try {
    const channel = new BroadcastChannel(channelName)
    channel.postMessage({ from: thisPage, change } satisfies Message)
    channel.close()
  } catch {}
}

export function onLibraryChanged(listener: (change: LibraryChange) => void): () => void {
  const handle = (event: Event) => listener((event as CustomEvent<LibraryChange>).detail)
  changes.addEventListener('change', handle)
  let otherTabs: BroadcastChannel | null = null
  try {
    otherTabs = new BroadcastChannel(channelName)
    otherTabs.onmessage = ({ data }: MessageEvent<Message>) => {
      if (data.from !== thisPage) listener(data.change)
    }
  } catch {}
  return () => {
    changes.removeEventListener('change', handle)
    otherTabs?.close()
  }
}
