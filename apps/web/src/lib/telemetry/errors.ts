import { clearQueue, type Queued, readQueue, writeQueue } from './queue'
import {
  type Environment,
  type ErrorCode,
  errorName,
  MAX_DELAY_SECONDS,
  parseReport,
  screenOf
} from './report'
import { sharingAllowed } from './sharing'

const TELEMETRY_PATH = '/api/telemetry/'

export const PAGE_LIMIT = 25

let reportedThisPage = 0
let flushing = false

function release(): string {
  return process.env.PEDOS_RELEASE || 'unknown'
}

function environment(): Environment {
  const env = process.env.PEDOS_ENVIRONMENT
  return env === 'staging' || env === 'production' ? env : 'local'
}

function credentials(): RequestCredentials {
  return environment() === 'production' ? 'omit' : 'same-origin'
}

function reportFor(code: ErrorCode, error: unknown, pathname: string): Queued['report'] | null {
  const name =
    typeof error === 'object' && error !== null
      ? errorName((error as { name?: unknown }).name)
      : undefined
  const report = parseReport({
    code,
    name,
    screen: screenOf(pathname),
    release: release(),
    environment: environment(),
    delaySeconds: 0
  })
  if (!report) return null
  const { delaySeconds: _, ...kept } = report
  return kept
}

export function reportError(code: ErrorCode, error?: unknown): void {
  try {
    if (!sharingAllowed() || reportedThisPage >= PAGE_LIMIT) return
    const report = reportFor(code, error, location.pathname)
    if (!report) return
    reportedThisPage += 1
    const item: Queued = { report, at: Date.now() }
    if (navigator.onLine === false) {
      enqueue(item)
      return
    }
    send(item)
      .then(outcome => {
        if (outcome === 'failed') enqueue(item)
        else if (outcome === 'sent') return flush()
      })
      .catch(() => {})
  } catch {}
}

function enqueue(item: Queued): void {
  if (sharingAllowed()) writeQueue([...readQueue(), item])
}

async function send({ report, at }: Queued): Promise<'sent' | 'refused' | 'failed'> {
  const body = parseReport({
    ...report,
    delaySeconds: Math.max(0, Math.round((Date.now() - at) / 1000))
  })
  if (!body || !sharingAllowed()) return 'refused'
  try {
    const response = await fetch(TELEMETRY_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      credentials: credentials(),
      keepalive: true
    })
    if (response.ok) return 'sent'
    return response.status >= 500 ? 'failed' : 'refused'
  } catch {
    return 'failed'
  }
}

export async function flush(): Promise<void> {
  if (flushing) return
  flushing = true
  try {
    if (!sharingAllowed()) {
      clearQueue()
      return
    }
    if (navigator.onLine === false) return
    for (const item of readQueue()) {
      const tooOld = Date.now() - item.at > MAX_DELAY_SECONDS * 1000
      if (!tooOld && (await send(item)) === 'failed') return
      const queue = readQueue()
      const index = queue.findIndex(q => q.at === item.at && q.report.code === item.report.code)
      if (index !== -1) queue.splice(index, 1)
      writeQueue(queue)
    }
  } catch {
  } finally {
    flushing = false
  }
}

export function installErrorReporting(): void {
  try {
    window.addEventListener('error', event => reportError('uncaught-error', event.error))
    window.addEventListener('unhandledrejection', event =>
      reportError('unhandled-rejection', event.reason)
    )
    window.addEventListener('online', () => void flush())
    void flush()
  } catch {}
}
