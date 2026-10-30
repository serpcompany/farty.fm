import { beforeEach, describe, expect, test, vi } from 'vitest'
import { forgetDecoded, play, playbackPosition, stopPlayback } from './player'

type FakeSource = {
  key: string
  started: boolean
  stopped: boolean
  onended: (() => void) | null
  /** What `start` was given: when, from where, for how long. */
  startedWith: number[]
}

const sources: FakeSource[] = []

/** The fake context's clock, in seconds: the test moves it. */
let clock = 0

/** The fake context's `outputLatency`, in seconds, or undefined where a browser doesn't report it. */
let latency: number | undefined

/**
 * Decodes that finish only when the test says so, like a Recording loading from IndexedDB, in the
 * order they began.
 */
const pending: { key: string; finish: () => void }[] = []

/** Finishes the `nth` decode of `key` still pending. */
function finish(key: string, nth = 0): void {
  const waiting = pending.filter(p => p.key === key)[nth]
  if (!waiting) throw new Error(`no decode of ${key} pending`)
  pending.splice(pending.indexOf(waiting), 1)
  waiting.finish()
}

vi.mock('./context', () => ({
  setPlaybackSession: () => {},
  whenClosing: () => {},
  isClosed: () => false,
  audioContext: () => ({
    get currentTime() {
      return clock
    },
    get outputLatency() {
      return latency
    },
    destination: {},
    resume: async () => {},
    decodeAudioData: (wav: ArrayBuffer) => {
      const key = new TextDecoder().decode(wav)
      if (key === 'broken') return Promise.reject(new Error('not audio'))
      return new Promise(resolve =>
        pending.push({ key, finish: () => resolve({ key, duration: 1 }) })
      )
    },
    createBufferSource: () => {
      const source = {
        key: '',
        started: false,
        stopped: false,
        onended: null as (() => void) | null,
        startedWith: [] as number[],
        set buffer(buffer: { key: string }) {
          source.key = buffer.key
        },
        connect: () => {},
        start: (...args: number[]) => {
          source.started = true
          source.startedWith = args
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
    pending.length = 0
    clock = 0
    latency = undefined
  })

  test('says where the sound playing is by the audio clock, from where it started to its end', async () => {
    clock = 5
    const playing = play('pos', wav('pos'), { start: 0.25, end: 0.75 }, () => {})
    await settle()
    expect(playbackPosition()).toBeNull()
    finish('pos')
    await playing
    // Started at once, from 0.25 s for 0.5 s: the clock reads 5 then.
    expect(sources[0].startedWith).toEqual([0, 0.25, 0.5])
    expect(playbackPosition()).toBe(0.25)
    clock = 5.2
    expect(playbackPosition()).toBeCloseTo(0.45, 9)
    clock = 9
    expect(playbackPosition()).toBe(0.75)
    stopPlayback()
    expect(playbackPosition()).toBeNull()
  })

  test('holds the playhead back by the latency the output reports, as on Bluetooth', async () => {
    clock = 5
    latency = 0.2
    const playing = play('late', wav('late'), { start: 0.25, end: 0.75 }, () => {})
    await settle()
    finish('late')
    await playing
    // Until the first sound reaches the speaker, the playhead waits where it starts.
    clock = 5.1
    expect(playbackPosition()).toBe(0.25)
    clock = 5.3
    expect(playbackPosition()).toBeCloseTo(0.35, 9)
    clock = 9
    expect(playbackPosition()).toBe(0.75)
  })

  test("a sound still loading when playback stops never starts, and says it's over", async () => {
    const ended = vi.fn()
    const playing = play('a', wav('a'), null, ended)
    await settle()
    stopPlayback()
    finish('a')
    await playing
    expect(sources).toEqual([])
    expect(ended).toHaveBeenCalledOnce()
  })

  test('a sound still loading when another starts never starts or ends, and the later one can be stopped', async () => {
    const endedA = vi.fn()
    const endedB = vi.fn()
    const playingA = play('slow', wav('slow'), null, endedA)
    await settle()
    const playingB = play('fast', wav('fast'), null, endedB)
    await settle()
    finish('fast')
    await playingB
    finish('slow')
    await playingA

    expect(sources.map(s => [s.key, s.started])).toEqual([['fast', true]])
    expect(endedA).not.toHaveBeenCalled()
    expect(endedB).not.toHaveBeenCalled()

    stopPlayback()
    expect(sources[0]?.stopped).toBe(true)
    expect(endedB).toHaveBeenCalledOnce()
  })

  test("starting another sound stops the one playing, without saying it's over", async () => {
    const endedA = vi.fn()
    const playingA = play('c', wav('c'), null, endedA)
    await settle()
    finish('c')
    await playingA
    const playingB = play('d', wav('d'), null, () => {})
    await settle()
    finish('d')
    await playingB

    expect(sources.map(s => [s.key, s.started, s.stopped])).toEqual([
      ['c', true, true],
      ['d', true, false]
    ])
    expect(endedA).not.toHaveBeenCalled()
  })

  test("tap A, tap B, tap A within A's first load: the first load never ends the second play of A", async () => {
    const endedA1 = vi.fn()
    const endedB = vi.fn()
    const endedA2 = vi.fn()
    const playingA1 = play('row-a', wav('row-a'), null, endedA1)
    await settle()
    const playingB = play('row-b', wav('row-b'), null, endedB)
    await settle()
    const playingA2 = play('row-a', wav('row-a'), null, endedA2)
    await settle()
    // Both plays of A share its one decode.
    expect(pending.map(p => p.key)).toEqual(['row-a', 'row-b'])
    finish('row-a')
    await Promise.all([playingA1, playingA2])
    finish('row-b')
    await playingB

    expect(sources.map(s => [s.key, s.started, s.stopped])).toEqual([['row-a', true, false]])
    expect(endedA1).not.toHaveBeenCalled()
    expect(endedB).not.toHaveBeenCalled()
    expect(endedA2).not.toHaveBeenCalled()

    stopPlayback()
    expect(sources[0]?.stopped).toBe(true)
    expect(endedA2).toHaveBeenCalledOnce()
  })

  test('a sound forgotten while it decodes is decoded again next time, so its buffer is never kept', async () => {
    const load = vi.fn(wav('forgotten'))
    const playing = play('forgotten', load, null, () => {})
    await settle()
    stopPlayback()
    forgetDecoded('forgotten')
    finish('forgotten')
    await playing
    const again = play('forgotten', load, null, () => {})
    await settle()
    finish('forgotten')
    await again
    expect(load).toHaveBeenCalledTimes(2)
    expect(sources.map(s => [s.key, s.started])).toEqual([['forgotten', true]])
  })

  test('a sound plays again from its decode, without loading it again', async () => {
    const load = vi.fn(wav('kept'))
    const first = play('kept', load, null, () => {})
    await settle()
    finish('kept')
    await first
    await play('kept', load, null, () => {})
    expect(load).toHaveBeenCalledOnce()
    expect(sources.map(s => s.key)).toEqual(['kept', 'kept'])
  })

  test("a sound that can't load says it's over", async () => {
    const ended = vi.fn()
    await play('broken', wav('broken'), null, ended)
    expect(sources).toEqual([])
    expect(ended).toHaveBeenCalledOnce()
  })
})
