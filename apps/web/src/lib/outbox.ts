// The outbox: what this browser still has to send to the account, one entry per Recording or
// Toot, kept in IndexedDB beside them (`recording-store.ts`) and written in the same transaction
// as the change it records. `library-sync.ts` sends it. Every save, rename, place and delete
// joins it, a guest's too, so signing in sends what a guest kept: their Recordings, and this
// visit's Toots. A guest's new visit clears the Toots' entries with the Toots (`visit.ts`).

/** A user's Recordings or their Toots, by the name of their store and their route. */
export type Kind = 'recordings' | 'toots'

/**
 * What the server still needs: the item itself, a Toot's new title, a Recording's Placed Pitch
 * (ADR 0015), or the delete.
 */
export type OutboxOp = 'put' | 'rename' | 'place' | 'delete'

export type OutboxEntry = {
  /** `{kind}:{id}` (`itemKey`). */
  key: string
  kind: Kind
  id: string
  op: OutboxOp
  /** A request for this op has gone out, so the server may have it. */
  sent: boolean
  /** When it was queued, for sending in order. */
  queuedAt: number
  /**
   * Changes with every new op, so a request that finishes knows whether the entry changed while
   * it was on its way (`settle` in `library-sync.ts`).
   */
  version: string
}

export const itemKey = (kind: Kind, id: string) => `${kind}:${id}`

/**
 * The entry after `op` joins what's already queued for the same item, or null when nothing is
 * left to send. Data is read when it's sent, so a rename of a Toot, or a place of a Recording,
 * whose upload hasn't gone out is in the upload. A delete beats everything, and drops an upload
 * no request has carried.
 */
export function mergeOutbox(
  queued: OutboxEntry | undefined,
  kind: Kind,
  id: string,
  op: OutboxOp,
  now: { at: number; version: string }
): OutboxEntry | null {
  const fresh = (next: OutboxOp): OutboxEntry => ({
    key: itemKey(kind, id),
    kind,
    id,
    op: next,
    sent: false,
    queuedAt: queued?.queuedAt ?? now.at,
    version: now.version
  })
  if (!queued) return fresh(op)
  if (queued.op === 'delete') return queued
  if (op === 'delete') return queued.op === 'put' && !queued.sent ? null : fresh('delete')
  if (op === 'rename' || op === 'place') {
    // An upload that may have reached the server still uploads, then renames or places (`settle`).
    return queued.op === 'put' ? { ...queued, version: now.version } : fresh(op)
  }
  return queued
}

/** A new op's time and version. */
export const queueStamp = () => ({ at: Date.now(), version: crypto.randomUUID() })

const queued = new EventTarget()

/** Says the outbox has something new to send. */
export function announceQueued(): void {
  queued.dispatchEvent(new Event('queued'))
}

/** Calls `listener` whenever something joins the outbox. Returns a function that stops it. */
export function onQueued(listener: () => void): () => void {
  queued.addEventListener('queued', listener)
  return () => queued.removeEventListener('queued', listener)
}
