import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { blockedStorage, memoryStorage } from './test-storage'

// The reload onto a new build (#222), in Node with the browser's globals stubbed. Each load of the
// module is a new page load in the same tab: sessionStorage stays.

const { reportError } = vi.hoisted(() => ({ reportError: vi.fn() }))
vi.mock('./telemetry/errors', () => ({ reportError }))

class FakeWorker extends EventTarget {
  readonly args: unknown[]
  constructor(...args: unknown[]) {
    super()
    this.args = args
  }
}

let page: EventTarget & { Worker: typeof Worker }
let reload: Mock<() => void>
let storage: Storage

/** A new page load: the module afresh, installed. */
async function load() {
  vi.resetModules()
  page = Object.assign(new EventTarget(), { Worker: FakeWorker as unknown as typeof Worker })
  vi.stubGlobal('window', page)
  const staleBuild = await import('./stale-build')
  staleBuild.installStaleBuildReload()
  return staleBuild
}

function chunkLoadError(): Error {
  const error = new Error(
    'Failed to load chunk /_next/static/chunks/0abc._.js from module 1234: undefined'
  )
  error.name = 'ChunkLoadError'
  return error
}

function throwOnPage(error: unknown) {
  page.dispatchEvent(Object.assign(new Event('error'), { error }))
}

function rejectOnPage(reason: unknown) {
  page.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason }))
}

function newWorker(): EventTarget {
  return new page.Worker(new URL('https://farty.test/_next/static/chunks/w.js'))
}

beforeEach(() => {
  reportError.mockClear()
  reload = vi.fn()
  vi.stubGlobal('location', { reload })
  storage = memoryStorage()
  vi.stubGlobal('sessionStorage', storage)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('a script of an older build that fails to load', () => {
  it('reloads the page once, and reports it', async () => {
    await load()
    const error = chunkLoadError()
    throwOnPage(error)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(reportError).toHaveBeenCalledExactlyOnceWith('stale-build', error)
  })

  it('reloads for a failed import() too', async () => {
    await load()
    rejectOnPage(
      new TypeError('Failed to fetch dynamically imported module: https://farty.test/a.js')
    )
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it("leaves the page alone for an error that isn't a script's", async () => {
    await load()
    throwOnPage(new TypeError("Cannot read properties of undefined (reading 'id')"))
    rejectOnPage(new DOMException('The operation was aborted.', 'AbortError'))
    rejectOnPage('Failed to load chunk')
    expect(reload).not.toHaveBeenCalled()
    expect(reportError).not.toHaveBeenCalled()
  })
})

describe("a worker's script that fails to load", () => {
  it('reloads the page when the worker itself fails to load', async () => {
    await load()
    const worker = newWorker()
    expect(worker).toBeInstanceOf(FakeWorker)
    expect((worker as FakeWorker).args[0]).toBeInstanceOf(URL)
    worker.dispatchEvent(new Event('error'))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('reloads the page when a script the worker imports fails to load', async () => {
    await load()
    newWorker().dispatchEvent(
      Object.assign(new Event('error'), {
        message:
          "Uncaught NetworkError: Failed to execute 'importScripts' on 'WorkerGlobalScope': The script at 'https://farty.test/_next/static/chunks/a.js' failed to load."
      })
    )
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it("leaves the page alone for the worker's own errors", async () => {
    await load()
    newWorker().dispatchEvent(
      Object.assign(new Event('error'), { message: 'Uncaught RangeError: Invalid array length' })
    )
    expect(reload).not.toHaveBeenCalled()
  })
})

describe('the reload', () => {
  it('waits while something unsaved is on screen, and comes once the last hold lets go', async () => {
    const { holdReload } = await load()
    const take = holdReload()
    const toot = holdReload()
    throwOnPage(chunkLoadError())
    expect(reload).not.toHaveBeenCalled()
    take()
    expect(reload).not.toHaveBeenCalled()
    toot()
    expect(reload).toHaveBeenCalledTimes(1)
    // A release that already happened changes nothing.
    toot()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it("doesn't wait for a hold released before the script failed", async () => {
    const { holdReload } = await load()
    holdReload()()
    throwOnPage(chunkLoadError())
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('comes at most once in the guard, so a build that keeps failing never loops', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-28T12:00:00Z') })
    const { reloadGuardMs } = await load()
    throwOnPage(chunkLoadError())
    expect(reload).toHaveBeenCalledTimes(1)

    // The reloaded page fails too: reported, not reloaded.
    await load()
    throwOnPage(chunkLoadError())
    expect(reload).toHaveBeenCalledTimes(1)
    expect(reportError).toHaveBeenCalledTimes(2)

    // Long after, a later deploy's failure reloads again.
    vi.advanceTimersByTime(reloadGuardMs + 1)
    await load()
    throwOnPage(chunkLoadError())
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('never comes when the tab has nowhere to note it', async () => {
    vi.stubGlobal('sessionStorage', blockedStorage())
    await load()
    throwOnPage(chunkLoadError())
    expect(reload).not.toHaveBeenCalled()
    expect(reportError).toHaveBeenCalledTimes(1)
  })
})
