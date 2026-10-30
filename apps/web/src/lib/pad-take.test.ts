import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetTake, keepTake, keptTake, keptTakes, MAX_KEPT_TAKES } from './pad-take'
import type { Performance } from './performance'

const A = '00000000-0000-4000-8000-00000000000a'
const T1 = '11111111-1111-4111-8111-111111111111'
const T2 = '22222222-2222-4222-8222-222222222222'
/** The Toot id of take `n`. */
const tootOf = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const performance: Performance = {
  recordings: [A],
  taps: [
    [0, 0],
    [0.5, 0]
  ]
}

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

beforeEach(() => {
  stubStorage()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the kept takes', () => {
  it('are kept by Toot id, newest first, so a new take never takes a paid one’s place', () => {
    expect(keptTakes()).toEqual([])
    expect(keepTake(T1, performance)).toBe(true)
    expect(keepTake(T2, performance)).toBe(true)
    expect(keptTakes().map(take => take.tootId)).toEqual([T2, T1])
    expect(keptTake(T1)).toEqual({ tootId: T1, performance })
    // Kept again, before Checkout, it's the newest.
    keepTake(T1, performance)
    expect(keptTakes().map(take => take.tootId)).toEqual([T1, T2])
  })

  it(`are at most ${MAX_KEPT_TAKES}, the oldest let go first`, () => {
    for (let n = 1; n <= MAX_KEPT_TAKES + 2; n++) keepTake(tootOf(n), performance)
    expect(keptTakes().map(take => take.tootId)).toEqual([7, 6, 5, 4, 3].map(tootOf))
  })

  it('let go of one take at a time, by its own Toot', () => {
    keepTake(T1, performance)
    keepTake(T2, performance)
    forgetTake(T1)
    expect(keptTakes().map(take => take.tootId)).toEqual([T2])
    forgetTake(T1)
    forgetTake(T2)
    expect(keptTakes()).toEqual([])
    expect(keptTake(T2)).toBeNull()
  })

  it('leave out whatever kept isn’t a take', () => {
    const items = stubStorage()
    for (const kept of [
      'not json',
      'null',
      '"take"',
      JSON.stringify({ tootId: T1, performance })
    ]) {
      items.set('pedos.padTakes', kept)
      expect(keptTakes()).toEqual([])
    }
    items.set(
      'pedos.padTakes',
      JSON.stringify([
        { tootId: T1 },
        { tootId: 1, performance },
        { tootId: T1, performance: { recordings: [A], taps: [] } },
        { tootId: T2, performance }
      ])
    )
    expect(keptTakes()).toEqual([{ tootId: T2, performance }])
  })

  it('say so when storage won’t keep a take, and never throw', () => {
    stubStorage(true)
    expect(keepTake(T1, performance)).toBe(false)
    expect(keptTakes()).toEqual([])
    expect(keptTake(T1)).toBeNull()
    expect(() => forgetTake(T1)).not.toThrow()
  })
})
