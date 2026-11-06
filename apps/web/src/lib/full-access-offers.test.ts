import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clearOfferReturn,
  isOfferPlace,
  keepOfferNext,
  offerReturnPath,
  readOfferReturn,
  takeOfferNext,
  takeResultOffer
} from './full-access-offers'

/** A plain store, as `localStorage` and `sessionStorage` are. */
function fakeStorage() {
  const held = new Map<string, string>()
  return {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => void held.set(key, value),
    removeItem: (key: string) => void held.delete(key)
  }
}

const blockedStorage = {
  getItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('blocked')
  },
  removeItem: () => {
    throw new Error('blocked')
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('an offer’s return from Checkout', () => {
  it('knows only the two places', () => {
    expect(isOfferPlace('welcome')).toBe(true)
    expect(isOfferPlace('result')).toBe(true)
    for (const other of ['save', '', null, undefined, 1, ['welcome']]) {
      expect(isOfferPlace(other)).toBe(false)
    }
  })

  it('comes back to Welcome’s first screen, and a Result’s Recordings tab, which opens no microphone', () => {
    expect(offerReturnPath('welcome', true)).toBe('/?offer=welcome&checkout=done')
    expect(offerReturnPath('welcome', false)).toBe('/?offer=welcome')
    expect(offerReturnPath('result', true)).toBe('/recordings/?offer=result&checkout=done')
    expect(offerReturnPath('result', false)).toBe('/recordings/?offer=result')
  })

  it('reads its own address, paid or cancelled, and no other', () => {
    const at = (pathname: string, search: string) => readOfferReturn({ pathname, search })
    expect(at('/', '?offer=welcome&checkout=done')).toEqual({ place: 'welcome', done: true })
    expect(at('/recordings/', '?offer=result')).toEqual({ place: 'result', done: false })
    expect(at('/', '')).toBeNull()
    expect(at('/', '?offer=elsewhere&checkout=done')).toBeNull()
    expect(at('/', '?toot=1&checkout=done')).toBeNull()
    // Each place returns only to its own address, and the dev checkout's page isn't a return.
    expect(at('/', '?offer=result')).toBeNull()
    expect(at('/dev/checkout/', '?offer=result')).toBeNull()
    expect(at('/dev/checkout/', '?offer=welcome')).toBeNull()
  })

  it('takes its query off the address, and leaves any other alone', () => {
    const replaceState = vi.fn()
    vi.stubGlobal('window', {
      location: { pathname: '/recordings/', search: '?offer=result&checkout=done' },
      history: { replaceState }
    })
    clearOfferReturn()
    expect(replaceState).toHaveBeenCalledWith(null, '', '/recordings/')

    replaceState.mockClear()
    vi.stubGlobal('window', {
      location: { pathname: '/compose/pad/', search: '?toot=1' },
      history: { replaceState }
    })
    clearOfferReturn()
    expect(replaceState).not.toHaveBeenCalled()
  })
})

describe('takeResultOffer', () => {
  it('offers once per browser', () => {
    vi.stubGlobal('localStorage', fakeStorage())
    expect(takeResultOffer()).toBe(true)
    expect(takeResultOffer()).toBe(false)
  })

  it('never offers when it couldn’t remember', () => {
    vi.stubGlobal('localStorage', blockedStorage)
    expect(takeResultOffer()).toBe(false)
  })
})

describe('where a Result’s tap was going', () => {
  it('is kept across Checkout, and read once', () => {
    vi.stubGlobal('sessionStorage', fakeStorage())
    expect(takeOfferNext()).toBeNull()
    keepOfferNext('/compose/twinkle/')
    expect(takeOfferNext()).toBe('/compose/twinkle/')
    expect(takeOfferNext()).toBeNull()
  })

  it('is simply lost with storage blocked', () => {
    vi.stubGlobal('sessionStorage', blockedStorage)
    expect(() => keepOfferNext('/')).not.toThrow()
    expect(takeOfferNext()).toBeNull()
  })
})
