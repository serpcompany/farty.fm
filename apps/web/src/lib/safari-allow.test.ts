import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SafariAllowRoute } from './install'
import { safariAllowRouteToTell } from './safari-allow'

const browser: {
  memory: 'remembered' | 'forgotten' | 'unknown'
  route: SafariAllowRoute | null
} = { memory: 'forgotten', route: 'page-menu' }

vi.mock('./audio/recorder', () => ({ microphoneGrantMemory: () => browser.memory }))
vi.mock('./install', () => ({ currentSafariAllowRoute: () => browser.route }))

/** `localStorage`, across launches. */
function stubStorage() {
  const kept = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => kept.set(key, value)
  })
}

beforeEach(() => {
  browser.memory = 'forgotten'
  browser.route = 'page-menu'
  stubStorage()
})

describe('safariAllowRouteToTell', () => {
  it('tells an iPhone user whose grant is forgotten, once', () => {
    expect(safariAllowRouteToTell()).toBe('page-menu')
    expect(safariAllowRouteToTell()).toBeNull()
  })

  it('names the Home Screen’s route there', () => {
    browser.route = 'settings'
    expect(safariAllowRouteToTell()).toBe('settings')
  })

  it('never tells once the grant is remembered, even if it’s forgotten later', () => {
    browser.memory = 'remembered'
    expect(safariAllowRouteToTell()).toBeNull()
    browser.memory = 'forgotten'
    expect(safariAllowRouteToTell()).toBeNull()
  })

  it('waits while it doesn’t know, and still tells afterwards', () => {
    browser.memory = 'unknown'
    expect(safariAllowRouteToTell()).toBeNull()
    browser.memory = 'forgotten'
    expect(safariAllowRouteToTell()).toBe('page-menu')
  })

  it('never tells a browser Safari’s setting doesn’t reach', () => {
    browser.route = null
    expect(safariAllowRouteToTell()).toBeNull()
  })

  it('doesn’t tell where it couldn’t remember having told', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      }
    })
    expect(safariAllowRouteToTell()).toBeNull()
  })
})
