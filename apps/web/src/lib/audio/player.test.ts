import { beforeEach, describe, expect, test, vi } from 'vitest'
import { play, stopPlayback } from './player'

type FakeSource = { key: string; started: boolean; stopped: boolean; onended: (() => void) | null }

const sources: FakeSource[] = []

/** A decode that finishes only when the test says so, like a Recording loading from IndexedDB. */
const pending = new Map<string, () => void>()

vi.mock('./context', () => ({
  setAudioSession: () => {},
  audioContext: () => ({
    destination: {},
    resume: async () => {},
    decodeAudioData: (wav: ArrayBuffer) => {
      const key = new TextDecoder().decode(wav)
      return new Promise(resolve => pending.set(key, () => resolve({ key, duration: 1 })))
    },
    createBufferSource: () => {
      const source = {
        key: '',
        started: false,
        stopped: false,
        onended: null as (() => void) | null,
        set buffer(buffer: { key: string }) {
          source.key = buffer.key
        },
        connect: () => {},
        start: () => {
          source.started = true
        },
        stop: () => {
          source.stopped = true
          source.onended?.()
        }
      }
      sources.push(source)
      return source
    }
  })
}))

const wav = (key: string) => async () => new TextEncoder().encode(key).buffer as ArrayBuffer

/** Lets the awaits inside `play` run. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe('the player', () => {
  beforeEach(() => {
    stopPlayback()
    sources.length = 0
    pending.clear()
  })

  test("a sound still loading when playback stops never starts, and says it's over", async () => {
    const ended = vi.fn()
    const playing = play('a', wav('a'), null, ended)
    await settle()
    stopPlayback()
    pending.get('a')?.()
    await playing
    expect(sources).toEqual([])
    expect(ended).toHaveBeenCalledOnce()
  })

  test('a sound still loading when another starts never starts, and the later one can be stopped', async () => {
    const endedA = vi.fn()
    const endedB = vi.fn()
    const playingA = play('slow', wav('slow'), null, endedA)
    await settle()
    const playingB = play('fast', wav('fast'), null, endedB)
    await settle()
    pending.get('fast')?.()
    await playingB
    pending.get('slow')?.()
    await playingA

    expect(sources.map(s => [s.key, s.started])).toEqual([['fast', true]])
    expect(endedA).toHaveBeenCalledOnce()
    expect(endedB).not.toHaveBeenCalled()

    stopPlayback()
    expect(sources[0]?.stopped).toBe(true)
    expect(endedB).toHaveBeenCalledOnce()
  })

  test('starting another sound stops the one playing', async () => {
    const endedA = vi.fn()
    const playingA = play('c', wav('c'), null, endedA)
    await settle()
    pending.get('c')?.()
    await playingA
    const playingB = play('d', wav('d'), null, () => {})
    await settle()
    pending.get('d')?.()
    await playingB

    expect(sources.map(s => [s.key, s.started, s.stopped])).toEqual([
      ['c', true, true],
      ['d', true, false]
    ])
    expect(endedA).toHaveBeenCalledOnce()
  })
})
