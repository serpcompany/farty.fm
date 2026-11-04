// Says something kept in the `pedos` database changed, in this tab and Farty's other tabs, so
// each reads it again: the Favorite Songs (`favorite-store.ts`) and Fart Choices
// (`fart-choice-store.ts`).

/** This page, so it skips its own changes when they come back from the other tabs' channel. */
const thisPage = typeof crypto === 'undefined' ? '' : crypto.randomUUID()

/** A change signal on the BroadcastChannel `channelName`. */
export function changeSignal(channelName: string) {
  const changes = new EventTarget()
  return {
    /** Says it changed here: this tab and Farty's other tabs read it again. */
    changed(): void {
      changes.dispatchEvent(new Event('change'))
      try {
        const channel = new BroadcastChannel(channelName)
        channel.postMessage(thisPage)
        channel.close()
      } catch {
        // The other tabs read it again when they next open.
      }
    },
    /** Calls `listener` whenever it changes, in this tab or another. Returns a function that stops it. */
    onChanged(listener: () => void): () => void {
      changes.addEventListener('change', listener)
      let others: BroadcastChannel | null = null
      try {
        others = new BroadcastChannel(channelName)
        others.onmessage = ({ data }: MessageEvent<string>) => {
          if (data !== thisPage) listener()
        }
      } catch {
        // Only this tab's changes, then.
      }
      return () => {
        changes.removeEventListener('change', listener)
        others?.close()
      }
    }
  }
}
