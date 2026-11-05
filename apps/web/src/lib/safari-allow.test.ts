import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shouldTellOfSafariAllow } from './safari-allow'

const browser: {
  memory: 'remembered' | 'forgotten' | 'unknown'
  usesSafariSetting: boolean
} = { memory: 'forgotten', usesSafariSetting: true }

vi.mock('./audio/recorder', () => ({ microphoneGrantMemory: () => browser.memory }))
vi.mock('./install', () => ({
  currentlyUsesSafariMicrophoneSetting: () => browser.usesSafariSetting
}))

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
  browser.usesSafariSetting = true
  stubStorage()
})

describe('shouldTellOfSafariAllow', () => {
  it('tells an iPhone user whose grant is forgotten, once', () => {
    expect(shouldTellOfSafariAllow()).toBe(true)
    expect(shouldTellOfSafariAllow()).toBe(false)
  })

  it('never tells once the grant is remembered, even if it’s forgotten later', () => {
    browser.memory = 'remembered'
    expect(shouldTellOfSafariAllow()).toBe(false)
    browser.memory = 'forgotten'
    expect(shouldTellOfSafariAllow()).toBe(false)
  })

  it('waits while it doesn’t know, and still tells afterwards', () => {
    browser.memory = 'unknown'
    expect(shouldTellOfSafariAllow()).toBe(false)
    browser.memory = 'forgotten'
    expect(shouldTellOfSafariAllow()).toBe(true)
  })

  it('never tells a browser Safari’s setting doesn’t reach', () => {
    browser.usesSafariSetting = false
    expect(shouldTellOfSafariAllow()).toBe(false)
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
    expect(shouldTellOfSafariAllow()).toBe(false)
  })
})
