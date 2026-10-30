import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  adoptTakes,
  forgetTake,
  keepForCheckout,
  keepTake,
  keptTake,
  keptTakes,
  MAX_KEPT_TAKES,
  releaseTakes
} from './pad-take'
import type { Performance } from './performance'

const A = '00000000-0000-4000-8000-00000000000a'
const T1 = '11111111-1111-4111-8111-111111111111'
const T2 = '22222222-2222-4222-8222-222222222222'
const T3 = '33333333-3333-4333-8333-333333333333'
/** The Toot id of take `n`. */
const tootOf = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const performance: Performance = {
  recordings: [A],
  taps: [
    [0, 0],
    [0.5, 0]
  ]
}
const ids = () => keptTakes().map(take => take.tootId)

/** A browser's localStorage, or one that throws on every call. */
function stubStorage(throws = false) {
  const items = new Map<string, string>()
  const fail = () => {
    throw new Error('SecurityError')
  }
  vi.stubGlobal('localStorage', {
    getItem: throws ? fail : (key: string) => items.get(key) ?? null,
    setItem: throws ? fail : (key: string, value: string) => void items.set(key, value),
    removeItem: throws ? fail : (key: string) => void items.delete(key)
  })
  return items
}

let items = new Map<string, string>()
/** This browser's library becomes `account`'s, or a guest's with null. */
const libraryOf = (account: string | null) =>
  account === null ? items.delete('pedos.account') : items.set('pedos.account', account)

beforeEach(() => {
  items = stubStorage()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the kept takes', () => {
  it('are kept by Toot id, newest first, as the library’s', () => {
    expect(keptTakes()).toEqual([])
    expect(keepTake(T1, performance)).toBe(true)
    expect(keepTake(T2, performance)).toBe(true)
    expect(ids()).toEqual([T2, T1])
    expect(keptTake(T1)).toEqual({ tootId: T1, performance, account: null, checkout: false })
    // Kept again before Checkout, it's the newest, and the paying account's.
    expect(keepForCheckout(T1, performance, 'userA')).toBe(true)
    libraryOf('userA')
    expect(keptTakes()).toEqual([{ tootId: T1, performance, account: 'userA', checkout: true }])
  })

  it(`are at most ${MAX_KEPT_TAKES} with no Checkout, so a new take never pushes out one that may be paid for`, () => {
    libraryOf('userA')
    keepForCheckout(T1, performance, 'userA')
    for (let n = 1; n <= MAX_KEPT_TAKES + 2; n++) keepTake(tootOf(n), performance)
    expect(ids()).toEqual([...[7, 6, 5, 4, 3].map(tootOf), T1])
  })

  it(`are at most ${MAX_KEPT_TAKES} with a Checkout started too, the oldest let go first`, () => {
    libraryOf('userA')
    keepTake(T1, performance)
    for (let n = 1; n <= MAX_KEPT_TAKES + 1; n++) keepForCheckout(tootOf(n), performance, 'userA')
    expect(ids()).toEqual([...[6, 5, 4, 3, 2].map(tootOf), T1])
  })

  it('let go of one take at a time, by its own Toot', () => {
    keepTake(T1, performance)
    keepTake(T2, performance)
    forgetTake(T1)
    expect(ids()).toEqual([T2])
    forgetTake(T1)
    forgetTake(T2)
    expect(keptTakes()).toEqual([])
    expect(keptTake(T2)).toBeNull()
    expect(items.has('pedos.padTakes')).toBe(false)
  })

  it('are only ever the library’s own: never another account’s, nor a guest’s', () => {
    libraryOf('userA')
    keepTake(T1, performance)
    libraryOf('userB')
    keepTake(T2, performance)
    expect(ids()).toEqual([T2])
    expect(keptTake(T1)).toBeNull()
    libraryOf(null)
    expect(keptTakes()).toEqual([])
    keepTake(T3, performance)
    expect(ids()).toEqual([T3])
    libraryOf('userA')
    expect(ids()).toEqual([T1])
  })

  it('go with the library, but those a Checkout started stay for their account', () => {
    libraryOf('userA')
    keepTake(T1, performance)
    keepForCheckout(T2, performance, 'userA')
    libraryOf('userB')
    keepTake(T3, performance)
    // userA signs out, or another account signs in here.
    releaseTakes('userA')
    libraryOf('userA')
    expect(ids()).toEqual([T2])
    libraryOf('userB')
    expect(ids()).toEqual([T3])
  })

  it('of a guest’s visit go with it, and join the account the guest signs in to', () => {
    keepTake(T1, performance)
    keepTake(T2, performance)
    adoptTakes(null, 'userA')
    libraryOf('userA')
    expect(ids()).toEqual([T2, T1])
    libraryOf(null)
    keepTake(T3, performance)
    releaseTakes(null)
    expect(keptTakes()).toEqual([])
    libraryOf('userA')
    expect(ids()).toEqual([T2, T1])
  })

  it('leave out whatever kept isn’t a take', () => {
    const take = { tootId: T2, performance, account: null, checkout: false }
    for (const kept of ['not json', 'null', '"take"', JSON.stringify(take)]) {
      items.set('pedos.padTakes', kept)
      expect(keptTakes()).toEqual([])
    }
    items.set(
      'pedos.padTakes',
      JSON.stringify([
        { tootId: T1 },
        { tootId: 1, performance, account: null, checkout: false },
        { tootId: T1, performance: { recordings: [A], taps: [] }, account: null, checkout: false },
        // From before a take was whose library it was.
        { tootId: T1, performance },
        { tootId: T1, performance, account: 1, checkout: false },
        take
      ])
    )
    expect(keptTakes()).toEqual([take])
  })

  it('say so when storage won’t keep a take, and never throw', () => {
    stubStorage(true)
    expect(keepTake(T1, performance)).toBe(false)
    expect(keepForCheckout(T1, performance, 'userA')).toBe(false)
    expect(keptTakes()).toEqual([])
    expect(keptTake(T1)).toBeNull()
    expect(() => forgetTake(T1)).not.toThrow()
    expect(() => releaseTakes(null)).not.toThrow()
    expect(() => adoptTakes(null, 'userA')).not.toThrow()
  })
})
