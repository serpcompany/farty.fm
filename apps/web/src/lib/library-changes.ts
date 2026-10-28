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
