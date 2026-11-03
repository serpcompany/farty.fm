import { reportError } from './telemetry/errors'

export const reloadGuardMs = 10 * 60_000
const reloadedAtKey = 'pedos.staleBuildReloadedAt'

const holds = new Set<symbol>()
let waiting = false
let reported = false

function isScriptLoadFailure(error: unknown): boolean {
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

function isWorkerScriptFailure(event: Event): boolean {
  const { message } = event as Partial<ErrorEvent>
  if (typeof message !== 'string') return true
  return /NetworkError|importScripts|Failed to load chunk|ChunkLoadError/i.test(message)
}

function staleBuildFound(error: unknown): void {
  if (!reported) {
    reported = true
    reportError('stale-build', error)
  }
  waiting = true
  reloadIfFree()
}

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

function reloadedRecently(): boolean {
  try {
    const last = Number(sessionStorage.getItem(reloadedAtKey))
    if (last > 0 && Date.now() - last < reloadGuardMs) return true
    sessionStorage.setItem(reloadedAtKey, String(Date.now()))
    return false
  } catch {
    return true
  }
}

export function installStaleBuildReload(): void {
  try {
    window.addEventListener('error', event => {
      if (isScriptLoadFailure(event.error)) staleBuildFound(event.error)
    })
    window.addEventListener('unhandledrejection', event => {
      if (isScriptLoadFailure(event.reason)) staleBuildFound(event.reason)
    })
    watchWorkers()
  } catch {}
}

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
