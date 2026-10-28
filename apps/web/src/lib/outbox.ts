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
  accountFull?: true
}

export const itemKey = (kind: Kind, id: string) => `${kind}:${id}`

export const waitsForRoom = (entry: OutboxEntry) => entry.accountFull === true

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

const outboxEvents = new EventTarget()

export function announceQueued(): void {
  outboxEvents.dispatchEvent(new Event('queued'))
}

export function announceSent(): void {
  outboxEvents.dispatchEvent(new Event('sent'))
}

export function onQueued(listener: () => void): () => void {
  outboxEvents.addEventListener('queued', listener)
  return () => outboxEvents.removeEventListener('queued', listener)
}

export function onOutboxChanged(listener: () => void): () => void {
  const stops = ['queued', 'sent'].map(type => {
    outboxEvents.addEventListener(type, listener)
    return () => outboxEvents.removeEventListener(type, listener)
  })
  return () => {
    for (const stop of stops) stop()
  }
}
