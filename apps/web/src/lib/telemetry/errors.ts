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

/**
 * Error reports from the browser (#126): `reportError(code, error)` sends a stable code and a few
 * bounded fields to `/api/telemetry/`, which logs one line in Workers Logs. Nothing here throws or
 * waits: a report that can't be sent is queued or dropped, and recording and playback carry on.
 *
 * Sent only while sharing is on (`sharing.ts`). Raised offline, or when the send fails, a report
 * waits on the device (`queue.ts`) and goes once the browser is online again, on the next report
 * that gets through, or on the next page load.
 */

export const TELEMETRY_PATH = '/api/telemetry/'

/** At most this many reports from one page load, so an error in a loop can't flood the logs. */
export const PAGE_LIMIT = 25

let reportedThisPage = 0
let flushing = false

/** The build's release and environment, set by `next.config.ts`. */
function release(): string {
  return process.env.PEDOS_RELEASE || 'unknown'
}

function environment(): Environment {
  const env = process.env.PEDOS_ENVIRONMENT
  return env === 'staging' || env === 'production' ? env : 'local'
}

/**
 * In Production, none: no cookie, so a signed-in user's session never goes with a report. The
 * browser still sends Origin on a POST, which the route checks. Elsewhere, the Staging gate's
 * password, which `fetch` counts as a credential too, or the gate refuses the report (401).
 */
function credentials(): RequestCredentials {
  return environment() === 'production' ? 'omit' : 'same-origin'
}

/**
 * The allowlist, as Sentry's `beforeSend`: the report keeps only the code, the error's type name
 * (`TypeError`, never its message), the screen and the build. Anything else in `error` is dropped.
 */
export function reportFor(
  code: ErrorCode,
  error: unknown,
  pathname: string
): Queued['report'] | null {
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

/** Reports a handled error by its stable code. Never throws. */
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
  } catch {
    // Telemetry never breaks Pedos.
  }
}

function enqueue(item: Queued): void {
  if (sharingAllowed()) writeQueue([...readQueue(), item])
}

/** `sent`; `refused`, never to be sent again; or `failed`, to try again later. */
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

/** Sends the waiting reports, oldest first, until one fails. Never throws. */
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
      // Only this one: another report may share its code and time.
      const queue = readQueue()
      const index = queue.findIndex(q => q.at === item.at && q.report.code === item.report.code)
      if (index !== -1) queue.splice(index, 1)
      writeQueue(queue)
    }
  } catch {
    // Left for the next try.
  } finally {
    flushing = false
  }
}

/**
 * Reports what nothing caught, and sends the waiting reports now and whenever the browser comes
 * back online. Run once, before the app is interactive (`src/instrumentation-client.ts`).
 */
export function installErrorReporting(): void {
  try {
    window.addEventListener('error', event => reportError('uncaught-error', event.error))
    window.addEventListener('unhandledrejection', event =>
      reportError('unhandled-rejection', event.reason)
    )
    window.addEventListener('online', () => void flush())
    void flush()
  } catch {
    // Telemetry never breaks Pedos.
  }
}
