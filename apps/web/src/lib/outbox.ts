export type Kind = 'recordings' | 'toots'

export type OutboxKind = Kind | 'favorites'

export type OutboxOp = 'put' | 'rename' | 'place' | 'delete'

export type PlacedField = 'placedPitch' | 'trim' | 'name'

export const placedFieldNames = ['placedPitch', 'trim', 'name'] as const satisfies PlacedField[]

export type OutboxEntry = {
  key: string
  kind: OutboxKind
  id: string
  op: OutboxOp
  sent: boolean
  queuedAt: number
  version: string
  fields?: PlacedField[]
  reached?: boolean
  accountFull?: true
}

export const itemKey = (kind: OutboxKind, id: string) => `${kind}:${id}`

export const waitsForRoom = (entry: OutboxEntry) => entry.accountFull === true

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
    const before = queued.op === 'put' ? (queued.fields ?? []) : placedFields(queued)
    const merged = unionFields(before, fields)
    return queued.op === 'put'
      ? { ...queued, version: now.version, fields: merged }
      : { ...fresh(op), fields: merged }
  }
  if (op === 'rename') {
    return queued.op === 'put' ? { ...queued, version: now.version } : fresh(op)
  }
  return queued
}

export function placedFields(entry: OutboxEntry): PlacedField[] {
  if (entry.op !== 'place') return entry.fields ?? []
  return entry.fields ?? ['placedPitch']
}

const unionFields = (a: PlacedField[], b: PlacedField[]): PlacedField[] =>
  placedFieldNames.filter(field => a.includes(field) || b.includes(field))

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
