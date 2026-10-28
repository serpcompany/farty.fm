export type Kind = 'recordings' | 'toots'

export type OutboxOp = 'put' | 'rename' | 'place' | 'delete'

export type OutboxEntry = {
  key: string
  kind: Kind
  id: string
  op: OutboxOp
  sent: boolean
  queuedAt: number
  version: string
}

export const itemKey = (kind: Kind, id: string) => `${kind}:${id}`

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
    return queued.op === 'put' ? { ...queued, version: now.version } : fresh(op)
  }
  return queued
}

export const queueStamp = () => ({ at: Date.now(), version: crypto.randomUUID() })

const queued = new EventTarget()

export function announceQueued(): void {
  queued.dispatchEvent(new Event('queued'))
}

export function onQueued(listener: () => void): () => void {
  queued.addEventListener('queued', listener)
  return () => queued.removeEventListener('queued', listener)
}
