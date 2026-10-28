import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { blockedStorage, memoryStorage } from '@/test-support/web-storage'
import { PAGE_LIMIT } from './errors'
import { QUEUE_LIMIT } from './queue'

const SECRET = 'test@example.com'

let fetchMock: Mock<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>
let browser: { onLine: boolean; globalPrivacyControl?: boolean }

async function load() {
  vi.resetModules()
  const { flush, installErrorReporting, reportError } = await import('./errors')
  const { readQueue } = await import('./queue')
  const { setSharing, sharing } = await import('./sharing')
  return { flush, installErrorReporting, readQueue, reportError, setSharing, sharing }
}

function sentBodies(): Record<string, unknown>[] {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))
}

async function settle() {
  for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0))
}

function answer(status: number) {
  fetchMock.mockImplementation(async () => new Response(null, { status }))
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  browser = { onLine: true }
  vi.stubGlobal('navigator', browser)
  vi.stubGlobal('location', { pathname: '/compose/2f1c-my-secret-song/' })
  fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('FARTY_RELEASE', '1.2.0+1bb4403')
  vi.stubEnv('FARTY_ENVIRONMENT', 'staging')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('reportError', () => {
  it('sends the code, the error type, the screen and the build, and nothing else', async () => {
    const { reportError } = await load()
    const error = Object.assign(new TypeError(`Couldn't read ${SECRET}`), {
      recordingName: 'My best fart'
    })
    reportError('toot-make-failed', error)
    await settle()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [path, init] = fetchMock.mock.calls[0] ?? []
    expect(path).toBe('/api/telemetry/')
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', keepalive: true })
    expect(sentBodies()).toEqual([
      {
        code: 'toot-make-failed',
        name: 'TypeError',
        screen: 'compose',
        release: '1.2.0+1bb4403',
        environment: 'staging',
        delaySeconds: 0
      }
    ])
  })

  it('sends no cookie in Production, where no gate needs a password', async () => {
    vi.stubEnv('FARTY_ENVIRONMENT', 'production')
    const { reportError } = await load()
    reportError('toot-make-failed', new TypeError('x'))
    await settle()
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: 'omit' })
  })

  it('drops a seeded secret wherever it is: message, stack, name, extra fields, the path', async () => {
    const { reportError } = await load()
    const error = new Error(`message ${SECRET}`)
    error.stack = `Error: ${SECRET}\n    at render (song-creator.tsx:1:1)`
    reportError('synthetic-handled', error)
    reportError('synthetic-handled', Object.assign(new Error('x'), { name: SECRET }))
    reportError('synthetic-handled', SECRET)
    reportError('synthetic-handled', { name: 'NotAllowedError', message: SECRET, email: SECRET })
    await settle()

    const bodies = fetchMock.mock.calls.map(([, init]) => String(init?.body))
    expect(bodies).toHaveLength(4)
    for (const body of bodies) {
      expect(body).not.toContain(SECRET)
      expect(body).not.toContain('my-secret-song')
    }
    expect(sentBodies().map(body => body.name)).toEqual([
      'Error',
      undefined,
      undefined,
      'NotAllowedError'
    ])
  })

  it('sends nothing with the switch off', async () => {
    localStorage.setItem('pedos.telemetry', 'off')
    const { reportError, readQueue } = await load()
    reportError('mic-denied', new Error('x'))
    await settle()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(readQueue()).toEqual([])
  })

  it('sends nothing when the browser sends Global Privacy Control', async () => {
    browser.globalPrivacyControl = true
    const { reportError, readQueue, sharing } = await load()
    expect(sharing()).toBe('gpc')
    reportError('mic-denied', new Error('x'))
    await settle()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(readQueue()).toEqual([])
  })

  it('sends nothing, and never throws, when storage is blocked', async () => {
    vi.stubGlobal('localStorage', blockedStorage())
    const { reportError } = await load()
    expect(() => reportError('mic-denied', new Error('x'))).not.toThrow()
    await settle()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never throws when fetch throws or rejects', async () => {
    const { reportError } = await load()
    fetchMock.mockImplementation(() => {
      throw new TypeError('fetch is broken')
    })
    expect(() => reportError('mic-denied')).not.toThrow()
    fetchMock.mockImplementation(async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(() => reportError('mic-denied')).not.toThrow()
    await settle()
  })

  it('sends at most 25 reports from one page load', async () => {
    const { reportError } = await load()
    for (let i = 0; i < PAGE_LIMIT + 10; i++) reportError('analysis-failed')
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(PAGE_LIMIT)
  })
})

describe('offline and retry', () => {
  it('keeps a report raised offline, and sends it with its wait once back online', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-21T12:00:00Z') })
    browser.onLine = false
    const { reportError, readQueue, flush } = await load()
    reportError('recording-save-failed', new DOMException('full', 'QuotaExceededError'))
    await settle()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(readQueue()).toHaveLength(1)

    vi.setSystemTime(new Date('2026-10-21T12:01:30Z'))
    browser.onLine = true
    await flush()
    expect(sentBodies()).toEqual([
      expect.objectContaining({
        code: 'recording-save-failed',
        name: 'QuotaExceededError',
        delaySeconds: 90
      })
    ])
    expect(readQueue()).toEqual([])
  })

  it('of two same reports raised in the same millisecond, keeps the one whose send failed', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-21T12:00:00Z') })
    browser.onLine = false
    const { reportError, readQueue, flush } = await load()
    reportError('analysis-failed')
    reportError('analysis-failed')
    expect(readQueue()).toHaveLength(2)
    browser.onLine = true
    fetchMock
      .mockImplementationOnce(async () => new Response(null, { status: 204 }))
      .mockImplementationOnce(async () => new Response(null, { status: 503 }))
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(readQueue()).toHaveLength(1)
  })

  it('keeps only the newest 20 reports', async () => {
    browser.onLine = false
    const { reportError, readQueue } = await load()
    for (let i = 0; i < 24; i++) reportError(i < 4 ? 'mic-denied' : 'analysis-failed')
    expect(readQueue()).toHaveLength(QUEUE_LIMIT)
    expect(readQueue().every(item => item.report.code === 'analysis-failed')).toBe(true)
  })

  it('keeps a report whose send failed, and sends it after the next one that gets through', async () => {
    const { reportError, readQueue } = await load()
    answer(503)
    reportError('toots-load-failed')
    await settle()
    expect(readQueue()).toHaveLength(1)

    answer(204)
    reportError('toot-delete-failed')
    await settle()
    expect(sentBodies().map(body => body.code)).toEqual([
      'toots-load-failed',
      'toot-delete-failed',
      'toots-load-failed'
    ])
    expect(readQueue()).toEqual([])
  })

  it('keeps a report whose send rejected (no network), and sends it on the next page load', async () => {
    const first = await load()
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError('Failed to fetch')
    })
    first.reportError('toot-rename-failed')
    await settle()
    expect(first.readQueue()).toHaveLength(1)

    const next = await load()
    vi.stubGlobal('window', new EventTarget())
    next.installErrorReporting()
    await settle()
    expect(sentBodies().at(-1)).toMatchObject({ code: 'toot-rename-failed' })
    expect(next.readQueue()).toEqual([])
  })

  it('drops, and never retries, a report the route refused', async () => {
    const { reportError, readQueue } = await load()
    answer(400)
    reportError('toot-save-failed')
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(readQueue()).toEqual([])
  })

  it('drops a waiting report older than a week', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-01T12:00:00Z') })
    browser.onLine = false
    const { reportError, readQueue, flush } = await load()
    reportError('analysis-failed')
    vi.setSystemTime(new Date('2026-10-21T12:00:00Z'))
    browser.onLine = true
    await flush()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(readQueue()).toEqual([])
  })

  it('turning the switch off drops the waiting reports', async () => {
    browser.onLine = false
    const { reportError, readQueue, setSharing, flush } = await load()
    reportError('analysis-failed')
    expect(readQueue()).toHaveLength(1)
    setSharing(false)
    expect(readQueue()).toEqual([])
    browser.onLine = true
    await flush()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('installErrorReporting', () => {
  it('reports what nothing caught, by its type only, and sends the waiting reports online', async () => {
    const page = new EventTarget()
    vi.stubGlobal('window', page)
    const { installErrorReporting, readQueue } = await load()
    installErrorReporting()

    page.dispatchEvent(
      Object.assign(new Event('error'), { error: new RangeError(`crash ${SECRET}`) })
    )
    page.dispatchEvent(
      Object.assign(new Event('unhandledrejection'), { reason: new TypeError(SECRET) })
    )
    await settle()
    expect(sentBodies()).toEqual([
      expect.objectContaining({ code: 'uncaught-error', name: 'RangeError' }),
      expect.objectContaining({ code: 'unhandled-rejection', name: 'TypeError' })
    ])

    browser.onLine = false
    page.dispatchEvent(Object.assign(new Event('error'), { error: new SyntaxError('x') }))
    expect(readQueue()).toHaveLength(1)
    browser.onLine = true
    page.dispatchEvent(new Event('online'))
    await settle()
    expect(sentBodies().at(-1)).toMatchObject({ code: 'uncaught-error', name: 'SyntaxError' })
    expect(readQueue()).toEqual([])
  })
})
