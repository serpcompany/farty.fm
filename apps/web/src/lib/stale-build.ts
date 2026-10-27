import { reportError } from './telemetry/errors'

/**
 * A tab opened before a deploy keeps running the older build, and the scripts it loads later, such
 * as a tab's code or the render worker's, are gone from the server (#222). The service worker
 * answers with the copy it kept (`public/sw.js`). When a script still fails to load, the page
 * reloads once, onto the new build.
 *
 * What Next.js 16 already does, and this doesn't repeat: a client-side navigation whose server
 * answers from another build loads that page in full (`fetch-server-response`), and Turbopack
 * loads a failed chunk once more before it throws a `ChunkLoadError`.
 *
 * The reload waits while a take, a Recording's Review or Result, or an unsaved Toot is on screen
 * (`holdReload`), and comes once the last hold lets go. After a reload, the page doesn't reload
 * again for `reloadGuardMs`: a build that keeps failing is reported, never reloaded over and over.
 */

export const reloadGuardMs = 10 * 60_000
/** sessionStorage: when this tab last reloaded onto a new build. */
export const reloadedAtKey = 'pedos.staleBuildReloadedAt'

const holds = new Set<symbol>()
let waiting = false
let reported = false

/**
 * A script's chunk failed to load: Turbopack's `ChunkLoadError`, or a failed `import()`. A failed
 * `import()` is a `TypeError`: "Importing a module script failed." in WebKit (Safari 18.4, measured
 * in Playwright's WebKit), "Failed to fetch dynamically imported module: <url>" in Chromium.
 */
export function isScriptLoadFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const { name, message } = error as { name?: unknown; message?: unknown }
  if (name === 'ChunkLoadError') return true
  return (
    typeof message === 'string' &&
    /Failed to load chunk|dynamically imported module|Importing a module script failed/i.test(
      message
    )
  )
}

/**
 * A worker's script failed to load. The browser fires a plain `error` event when the worker's own
 * script doesn't load, and an `ErrorEvent` when one it imports doesn't: Turbopack's worker is a
 * classic one, whose bootstrap loads its chunks with `importScripts`. A failed `importScripts` is
 * a `NetworkError`, whose uncaught message is "NetworkError: Load failed" in WebKit (Safari 18.4,
 * measured in Playwright's WebKit) and "Uncaught NetworkError: Failed to execute 'importScripts'
 * …" in Chromium. Any other error in the worker is its own.
 */
export function isWorkerScriptFailure(event: Event): boolean {
  const { message } = event as Partial<ErrorEvent>
  if (typeof message !== 'string') return true
  return /NetworkError|importScripts|Failed to load chunk|ChunkLoadError/i.test(message)
}

/** A script of an older build failed to load: reloads once nothing holds the page. */
export function staleBuildFound(error: unknown): void {
  if (!reported) {
    reported = true
    reportError('stale-build', error)
  }
  waiting = true
  reloadIfFree()
}

/**
 * Holds off the reload while something unsaved is on screen. Returns the release; once the last
 * hold is released, a reload that waited comes then.
 */
export function holdReload(): () => void {
  const hold = Symbol('hold')
  holds.add(hold)
  return () => {
    if (holds.delete(hold)) reloadIfFree()
  }
}

function reloadIfFree(): void {
  if (!waiting || holds.size > 0) return
  waiting = false
  if (reloadedRecently()) return
  location.reload()
}

/** True when this tab reloaded within the guard. Otherwise notes this reload, and is false. */
function reloadedRecently(): boolean {
  try {
    const last = Number(sessionStorage.getItem(reloadedAtKey))
    if (last > 0 && Date.now() - last < reloadGuardMs) return true
    sessionStorage.setItem(reloadedAtKey, String(Date.now()))
    return false
  } catch {
    // With nowhere to note the reload, nothing would stop a loop: no reload.
    return true
  }
}

/**
 * Watches for scripts that fail to load: the page's, and each worker's (the render and analysis
 * workers'). Run once, before the app is interactive (`src/instrumentation-client.ts`).
 */
export function installStaleBuildReload(): void {
  try {
    window.addEventListener('error', event => {
      if (isScriptLoadFailure(event.error)) staleBuildFound(event.error)
    })
    window.addEventListener('unhandledrejection', event => {
      if (isScriptLoadFailure(event.reason)) staleBuildFound(event.reason)
    })
    watchWorkers()
  } catch {
    // A stale build only costs the reload.
  }
}

/**
 * A worker's errors reach only the worker's own object, so each new worker is watched. This adds
 * a listener and changes nothing else; the workers' clients handle their errors as before.
 */
function watchWorkers(): void {
  const NativeWorker = window.Worker
  if (typeof NativeWorker !== 'function') return
  window.Worker = class WatchedWorker extends NativeWorker {
    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options)
      this.addEventListener('error', event => {
        if (isWorkerScriptFailure(event)) staleBuildFound(event)
      })
    }
  }
}
