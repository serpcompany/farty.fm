// The outbox: what this browser still has to send to the account, one entry per Recording, Toot
// or Favorite Song, kept in IndexedDB beside them (`recording-store.ts`) and written in the same
// transaction as the change it records. `library-sync.ts` sends it. Every save, rename, place,
// delete and favorite joins it, a guest's too, so signing in sends what a guest kept: their
// Recordings, this visit's Toots and their Favorite Songs (#313). A guest's new visit clears the
// Toots' entries with the Toots (`visit.ts`).

/** A user's Recordings or their Toots, by the name of their store and their route. */
export type Kind = 'recordings' | 'toots'

/**
 * What an outbox entry is for: a Recording, a Toot, or a Favorite Song (#313), whose `put` marks
 * the Song a favorite on the account and whose `delete` takes it off.
 */
export type OutboxKind = Kind | 'favorites'

/**
 * What the server still needs: the item itself, a Toot's new title, a Recording's Placed Pitch
 * (ADR 0015), or the delete.
 */
export type OutboxOp = 'put' | 'rename' | 'place' | 'delete'

/** What a `place` changes on a Recording: its Placed Pitch (ADR 0015), its Trim (ADR 0019). */
export type PlacedField = 'placedPitch' | 'trim'

export type OutboxEntry = {
  /** `{kind}:{id}` (`itemKey`). */
  key: string
  kind: OutboxKind
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
  /**
   * The fields a `place`, or a `place` riding in a `put`, changed, so the PATCH sends only those
   * and leaves another browser's change to the other field on the account (ADR 0019). An entry
   * without it was queued by code from before #293, whose `place` only ever changed the Placed
   * Pitch (`placedFields`).
   */
  fields?: PlacedField[]
  /**
   * A Favorite Song's: a request for an earlier op on it went out, so the account may have that
   * op even though a later tap replaced it here (`mergeOutbox`).
   */
  reached?: boolean
}

export const itemKey = (kind: OutboxKind, id: string) => `${kind}:${id}`

/**
 * The entry after `op` joins what's already queued for the same item, or null when nothing is
 * left to send. Data is read when it's sent, so a rename of a Toot, or a place of a Recording,
 * whose upload hasn't gone out is in the upload. A delete beats everything, and drops an upload
 * no request has carried. A Favorite Song's last op wins, and is sent once an earlier one may have
 * reached the account: that one may be on its way, and may not arrive. A tap that undoes one no
 * request carried leaves nothing to send, so a guest's heart on and off again never takes the Song
 * off an account that marked it elsewhere.
 */
export function mergeOutbox(
  queued: OutboxEntry | undefined,
  kind: OutboxKind,
  id: string,
  op: OutboxOp,
  now: { at: number; version: string },
  fields: PlacedField[] = []
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
  if (kind === 'favorites') {
    if (queued?.op === op && !queued.sent) return queued
    const reached = Boolean(queued?.sent || queued?.reached)
    if (queued && queued.op !== op && !reached) return null
    return reached ? { ...fresh(op), reached } : fresh(op)
  }
  if (!queued) return op === 'place' ? { ...fresh(op), fields: unionFields([], fields) } : fresh(op)
  if (queued.op === 'delete') return queued
  if (op === 'delete') return queued.op === 'put' && !queued.sent ? null : fresh('delete')
  if (op === 'place') {
    // A place joins what's queued, and keeps the fields it changed: a request already on its
    // way may not arrive, and is then sent again with the later change.
    const before = queued.op === 'put' ? (queued.fields ?? []) : placedFields(queued)
    const merged = unionFields(before, fields)
    // An upload that may have reached the server still uploads, then places (`settle`).
    return queued.op === 'put'
      ? { ...queued, version: now.version, fields: merged }
      : { ...fresh(op), fields: merged }
  }
  if (op === 'rename') {
    // An upload that may have reached the server still uploads, then renames (`settle`).
    return queued.op === 'put' ? { ...queued, version: now.version } : fresh(op)
  }
  return queued
}

/**
 * The fields a queued `place` sends. One with none recorded was queued by code from before #293,
 * which never saw a Trim, so it sends the Placed Pitch alone and leaves the account's Trim.
 */
export function placedFields(entry: OutboxEntry): PlacedField[] {
  if (entry.op !== 'place') return entry.fields ?? []
  return entry.fields ?? ['placedPitch']
}

const unionFields = (a: PlacedField[], b: PlacedField[]): PlacedField[] =>
  (['placedPitch', 'trim'] as const).filter(field => a.includes(field) || b.includes(field))

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
