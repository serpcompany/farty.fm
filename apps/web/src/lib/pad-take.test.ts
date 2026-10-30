import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetTake, keepTake, keptTake } from './pad-take'
import type { Performance } from './performance'

const A = '00000000-0000-4000-8000-00000000000a'
const T1 = '11111111-1111-4111-8111-111111111111'
const T2 = '22222222-2222-4222-8222-222222222222'
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

describe('the kept take', () => {
  it('is the last take kept, with its Toot id', () => {
    expect(keptTake()).toBeNull()
    keepTake(T1, performance)
    keepTake(T2, performance)
    expect(keptTake()).toEqual({ tootId: T2, performance })
  })

  it('is let go only by its own Toot', () => {
    keepTake(T1, performance)
    forgetTake(T2)
    expect(keptTake()?.tootId).toBe(T1)
    forgetTake(T1)
    expect(keptTake()).toBeNull()
  })

  it('is nothing when what is kept is not a take', () => {
    const items = stubStorage()
    for (const kept of [
      'not json',
      'null',
      '"take"',
      JSON.stringify({ tootId: T1 }),
      JSON.stringify({ tootId: 1, performance }),
      JSON.stringify({ tootId: T1, performance: { recordings: [A], taps: [] } })
    ]) {
      items.set('pedos.padTake', kept)
      expect(keptTake()).toBeNull()
    }
  })

  it('is nothing, and never throws, when storage is blocked', () => {
    stubStorage(true)
    expect(() => keepTake(T1, performance)).not.toThrow()
    expect(keptTake()).toBeNull()
    expect(() => forgetTake(T1)).not.toThrow()
  })
})
