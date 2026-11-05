import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { memoryStorage } from '../test-storage'
import { sharingKey } from './sharing'
import { flushSteps, reachStep, STEPS_PATH, stepsKey } from './steps'

// The funnel's steps from the browser (#405), in Node with the browser's globals stubbed: each
// counts once, only for a new visitor, only while sharing is on, and nothing but its name goes.

const fetchMock = vi.fn<typeof fetch>()

/** Lets the sends started by `reachStep` finish. */
const settle = async () => {
  await flushSteps()
  await new Promise(resolve => setTimeout(resolve))
}

const sentSteps = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).step)

let browser: { onLine: boolean; globalPrivacyControl?: boolean }

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  browser = { onLine: true }
  vi.stubGlobal('navigator', browser)
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('reachStep', () => {
  it('sends only the step, as JSON, without sending it twice', async () => {
    reachStep('open')
    await settle()
    reachStep('open')
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [path, init] = fetchMock.mock.calls[0] ?? []
    expect(path).toBe(STEPS_PATH)
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe('{"step":"open"}')
    expect(JSON.parse(localStorage.getItem(stepsKey) ?? '')).toEqual({ open: 'sent' })
  })

  it('counts nothing for a browser that never counted open', async () => {
    reachStep('first-recording')
    reachStep('save-tapped')
    await settle()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(localStorage.getItem(stepsKey)).toBeNull()
  })

  it('counts each later step once, after open', async () => {
    reachStep('open')
    reachStep('mic-allowed')
    reachStep('first-recording')
    reachStep('mic-allowed')
    await settle()
    expect(sentSteps()).toEqual(['open', 'mic-allowed', 'first-recording'])
  })

  it('sends nothing with the switch off', async () => {
    localStorage.setItem(sharingKey, 'off')
    reachStep('open')
    await settle()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(localStorage.getItem(stepsKey)).toBeNull()
  })

  it('sends nothing under Global Privacy Control', async () => {
    browser.globalPrivacyControl = true
    reachStep('open')
    await settle()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('counts nothing when storage can’t keep it, and never throws', async () => {
    vi.stubGlobal('localStorage', {
      ...memoryStorage(),
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError')
      }
    })
    expect(() => reachStep('open')).not.toThrow()
    await settle()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('survives what it can’t read in storage', async () => {
    localStorage.setItem(stepsKey, '{not json')
    expect(() => reachStep('open')).not.toThrow()
    await settle()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ignores a kept name that isn’t a step', async () => {
    localStorage.setItem(stepsKey, JSON.stringify({ open: 'sent', paid: 'waiting' }))
    reachStep('mic-allowed')
    await settle()
    expect(sentSteps()).toEqual(['mic-allowed'])
  })
})

describe('a step that can’t be sent', () => {
  it('waits offline, and goes once the browser is back', async () => {
    browser.onLine = false
    reachStep('open')
    await settle()
    expect(fetchMock).not.toHaveBeenCalled()
    browser.onLine = true
    await flushSteps()
    expect(sentSteps()).toEqual(['open'])
    await flushSteps()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a network failure', () => Promise.reject(new TypeError('offline'))],
    ['a server error', () => Promise.resolve(new Response(null, { status: 500 }))],
    ['the rate limit', () => Promise.resolve(new Response(null, { status: 429 }))]
  ])('tries again after %s', async (_, answer) => {
    fetchMock.mockImplementationOnce(answer)
    reachStep('open')
    await settle()
    expect(JSON.parse(localStorage.getItem(stepsKey) ?? '')).toEqual({ open: 'waiting' })
    await flushSteps()
    expect(sentSteps()).toEqual(['open', 'open'])
    expect(JSON.parse(localStorage.getItem(stepsKey) ?? '')).toEqual({ open: 'sent' })
  })

  it('never sends again what the route refused for good', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 400 }))
    reachStep('open')
    await settle()
    await flushSteps()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('is dropped once sharing is turned off', async () => {
    browser.onLine = false
    reachStep('open')
    await settle()
    localStorage.setItem(sharingKey, 'off')
    browser.onLine = true
    await flushSteps()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem(stepsKey) ?? '')).toEqual({})
  })
})
