import { type ErrorReport, parseReport } from './report'

const queueKey = 'pedos.telemetry.queue'

export const QUEUE_LIMIT = 20

export type Queued = { report: Omit<ErrorReport, 'delaySeconds'>; at: number }

export function readQueue(): Queued[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(queueKey) ?? '[]')
    if (!Array.isArray(stored)) return []
    return stored.flatMap(item => {
      const at = (item as Queued | null)?.at
      const report = parseReport({ ...(item as Queued | null)?.report, delaySeconds: 0 })
      if (typeof at !== 'number' || !report) return []
      const { delaySeconds: _, ...kept } = report
      return [{ report: kept, at }]
    })
  } catch {
    return []
  }
}

export function writeQueue(queue: Queued[]): void {
  try {
    if (queue.length === 0) localStorage.removeItem(queueKey)
    else localStorage.setItem(queueKey, JSON.stringify(queue.slice(-QUEUE_LIMIT)))
  } catch {}
}

export function clearQueue(): void {
  writeQueue([])
}
