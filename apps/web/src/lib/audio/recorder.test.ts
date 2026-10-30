import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { errorName } from '@/lib/telemetry/report'
import { type CaptureBatch, type CaptureCommand, captureProcessorSource } from './capture-processor'

// The recorder against a stand-in for the browser: getUserMedia, an AudioContext whose clock the
// test runs, the shipped capture processor on that clock, and a page that hides and shows. A
// pipeline is broken in either of the two ways that could leave a take without its first batch, as
// on the owner's iPhone (#247): the context's clock stops, or the stream feeds the graph nothing
// while its track says it's live. Production's reports since #247 are all the first: the first
// take after the app came back from the background, on a context that says it runs (#280).

const quantum = 128
const sampleRate = 48_000

type Processor = {
  port: { onmessage: ((event: { data: CaptureCommand }) => void) | null }
  process(inputs: Float32Array[][]): boolean
}

class FakeTrack {
  readyState: MediaStreamTrackState = 'live'
  muted = false
  enabled = true
  onmute: (() => void) | null = null
  onunmute: (() => void) | null = null
  onended: (() => void) | null = null
  stop() {
    this.readyState = 'ended'
  }
}

class FakeStream {
  readonly track = new FakeTrack()
  /** False: the source feeds the graph no channels, though the track looks fine. */
  feeds = true
  getAudioTracks() {
    return [this.track]
  }
  getTracks() {
    return [this.track]
  }
}

class FakeNode {
  readonly port: {
    onmessage: ((event: MessageEvent<CaptureBatch>) => void) | null
    postMessage(command: CaptureCommand): void
  }
  readonly processor: Processor
  stream: FakeStream | null = null
  running = true

  constructor(readonly context: FakeContext) {
    let Registered: (new () => Processor) | undefined
    const reply = (data: CaptureBatch) =>
      queueMicrotask(() => this.port.onmessage?.({ data } as MessageEvent<CaptureBatch>))
    class AudioWorkletProcessor {
      port = { onmessage: null, postMessage: reply }
    }
    new Function(
      'AudioWorkletProcessor',
      'registerProcessor',
      'sampleRate',
      captureProcessorSource
    )(
      AudioWorkletProcessor,
      (_: string, processor: new () => Processor) => {
        Registered = processor
      },
      sampleRate
    )
    if (!Registered) throw new Error('The source registered no processor')
    const processor = new Registered()
    this.processor = processor
    this.port = {
      onmessage: null,
      postMessage: command => queueMicrotask(() => processor.port.onmessage?.({ data: command }))
    }
    context.nodes.push(this)
  }

  render() {
    if (!this.running) return
    const stream = this.stream
    const live = stream?.feeds && stream.track.readyState === 'live' && !stream.track.muted
    // A quiet room: noise, never exact zeros.
    const input = live ? [Float32Array.from({ length: quantum }, () => 0.001)] : []
    this.running = this.processor.process([input])
  }

  connect<T>(next: T): T {
    return next
  }
  disconnect() {}
}

class FakeContext extends EventTarget {
  state: AudioContextState = 'suspended'
  readonly sampleRate = sampleRate
  currentTime = 0
  /** False: the context says it's running but its clock has stopped. */
  renders = true
  readonly nodes: FakeNode[] = []
  readonly destination = {}
  readonly audioWorklet = { addModule: async (_: string) => {} }

  constructor() {
    super()
    world.contexts.push(this)
  }

  async resume() {
    if (this.state === 'closed') throw new DOMException('closed', 'InvalidStateError')
    if (this.state !== 'running') {
      this.state = 'running'
      this.dispatchEvent(new Event('statechange'))
    }
  }

  async close() {
    this.state = 'closed'
    this.dispatchEvent(new Event('statechange'))
  }

  createMediaStreamSource(stream: FakeStream) {
    return {
      connect: (node: FakeNode) => {
        node.stream = stream
        return node
      },
      disconnect() {}
    }
  }

  createGain() {
    return { gain: { value: 1 }, connect: <T>(next: T) => next, disconnect() {} }
  }

  /** One render quantum, if the clock runs. */
  tick() {
    if (this.state !== 'running' || !this.renders) return
    this.currentTime += quantum / sampleRate
    for (const node of this.nodes) node.render()
  }
}

const world = {
  contexts: [] as FakeContext[],
  streams: [] as FakeStream[],
  /** Breaks each new stream or context as it opens, while set. */
  breakNext: null as null | ((stream: FakeStream, context: FakeContext) => void)
}

/** The page: `document` and `window`, as far as the recorder uses them. */
class FakePage extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible'
}

let page = new FakePage()
let pageWindow = new EventTarget()

/**
 * The person leaves the app, as on iPhone: the page hides, Safari mutes the microphone's track
 * and stops each context. A context that lived through it says it runs again once resumed, but
 * its clock stands still (#280).
 */
function hide(how: 'background' | 'pagehide' = 'background') {
  page.visibilityState = 'hidden'
  page.dispatchEvent(new Event('visibilitychange'))
  if (how === 'pagehide') pageWindow.dispatchEvent(new Event('pagehide'))
  for (const stream of world.streams) {
    if (stream.track.readyState !== 'live') continue
    stream.track.muted = true
    stream.track.onmute?.()
  }
  for (const context of world.contexts) {
    context.renders = false
    if (context.state !== 'running') continue
    context.state = 'suspended'
    context.dispatchEvent(new Event('statechange'))
  }
}

/** The person comes back: the page shows, and Safari unmutes the track. */
function show() {
  page.visibilityState = 'visible'
  page.dispatchEvent(new Event('visibilitychange'))
  for (const stream of world.streams) {
    if (stream.track.readyState !== 'live') continue
    stream.track.muted = false
    stream.track.onunmute?.()
  }
}

async function recorder() {
  vi.resetModules()
  return import('./recorder')
}

beforeEach(() => {
  vi.useFakeTimers()
  world.contexts = []
  world.streams = []
  world.breakNext = null
  page = new FakePage()
  pageWindow = Object.assign(new EventTarget(), {
    // A phone: never the computer's product page.
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  })
  vi.stubGlobal('document', page)
  vi.stubGlobal('window', pageWindow)
  vi.stubGlobal('AudioContext', FakeContext)
  vi.stubGlobal('AudioWorkletNode', FakeNode)
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: vi.fn(async () => {
        const stream = new FakeStream()
        world.streams.push(stream)
        const context = world.contexts.at(-1)
        if (world.breakNext && context) world.breakNext(stream, context)
        return stream
      })
    },
    permissions: { query: async () => ({ state: 'prompt' }) }
  })
  // The audio thread: a quantum about every 3 ms.
  setInterval(() => {
    for (const context of world.contexts) context.tick()
  }, 3)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

type StartTake = (
  onInterrupted: () => void,
  onRetry?: (error: Error) => void
) => Promise<{ cancel(): void }>

/** Taps Record and waits `ms`: the take, or the error the tap shows, or neither yet. */
async function tap(startTake: StartTake, ms = 3500, onRetry?: (error: Error) => void) {
  let result: { take: { cancel(): void } | null; error: Error | null } = {
    take: null,
    error: null
  }
  startTake(() => {}, onRetry).then(
    take => {
      result = { take, error: null }
    },
    (error: Error) => {
      result = { take: null, error }
    }
  )
  await vi.advanceTimersByTimeAsync(ms)
  return result
}

describe('the first tap on Record after opening the app', () => {
  it('records at once after the app was in the background, keeping the stream', async () => {
    const { startTake, keepMicrophoneOpen } = await recorder()
    keepMicrophoneOpen()
    const first = await tap(startTake)
    expect(first.take).not.toBeNull()
    first.take?.cancel()

    hide()
    await vi.advanceTimersByTimeAsync(30_000)
    show()
    // The person taps a second after coming back, as both reports since #247 did.
    await vi.advanceTimersByTimeAsync(1000)
    const back = await tap(startTake, 500)
    expect(back.error).toBeNull()
    expect(back.take).not.toBeNull()
    // On a fresh context, with the stream kept through the hide, so iPhone doesn't ask (#222).
    expect(world.contexts).toHaveLength(2)
    expect(world.contexts[0].state).toBe('closed')
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce()
  })

  it('records at once in a tab opened again from the back-forward cache', async () => {
    const { startTake, keepMicrophoneOpen } = await recorder()
    keepMicrophoneOpen()
    const first = await tap(startTake)
    first.take?.cancel()

    // Leaving the page lets the microphone go; showing it again opens it without a tap.
    hide('pagehide')
    await vi.advanceTimersByTimeAsync(5000)
    show()
    await vi.advanceTimersByTimeAsync(1000)
    const back = await tap(startTake, 500)
    expect(back.error).toBeNull()
    expect(back.take).not.toBeNull()
    expect(world.contexts[0].state).toBe('closed')
    expect(world.contexts.at(-1)?.state).toBe('running')
  })

  it('keeps the microphone and context between takes while the page shows', async () => {
    const { startTake } = await recorder()
    const first = await tap(startTake)
    expect(first.take).not.toBeNull()
    first.take?.cancel()
    const second = await tap(startTake)
    expect(second.take).not.toBeNull()
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce()
    expect(world.contexts).toHaveLength(1)
  })
})

describe('a take whose context’s clock stands still', () => {
  it('tries once more by itself, on a fresh stream and context, and records', async () => {
    const { startTake } = await recorder()
    world.breakNext = (_, context) => {
      context.renders = false
      world.breakNext = null
    }
    const onRetry = vi.fn()
    const first = await tap(startTake, 5000, onRetry)
    expect(first.error).toBeNull()
    expect(first.take).not.toBeNull()
    // The first try is still reported, by its name.
    expect(onRetry).toHaveBeenCalledOnce()
    expect(errorName(onRetry.mock.calls[0][0].name)).toBe('NoAudioRunningClockStopped')
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2)
    expect(world.contexts).toHaveLength(2)
    expect(world.contexts[0].state).toBe('closed')
  })

  it('says it couldn’t start when the second try stands still too, and the next tap records', async () => {
    const { startTake } = await recorder()
    world.breakNext = (_, context) => {
      context.renders = false
    }
    const onRetry = vi.fn()
    const first = await tap(startTake, 8000, onRetry)
    expect(first.error?.message).toBe('No audio from the microphone')
    expect(errorName(first.error?.name)).toBe('NoAudioRunningClockStopped')
    expect(onRetry).toHaveBeenCalledOnce()

    world.breakNext = null
    const second = await tap(startTake)
    expect(second.error).toBeNull()
    expect(second.take).not.toBeNull()
    expect(world.contexts).toHaveLength(3)
  })
})

describe('a take whose stream feeds the graph nothing', () => {
  it('opens a fresh stream on the next tap, without trying again by itself', async () => {
    const { startTake } = await recorder()
    world.breakNext = stream => {
      stream.feeds = false
    }
    const onRetry = vi.fn()
    const first = await tap(startTake, 3500, onRetry)
    expect(first.error?.message).toBe('No audio from the microphone')
    // The error report keeps which: the clock ran, so the stream fed nothing.
    expect(errorName(first.error?.name)).toBe('NoAudioRunningClockRan')
    // No report shows a second try helps here (#280), so the person taps Try again.
    expect(onRetry).not.toHaveBeenCalled()

    world.breakNext = null
    const second = await tap(startTake)
    expect(second.error).toBeNull()
    expect(second.take).not.toBeNull()
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2)
    expect(world.streams[0].track.readyState).toBe('ended')
  })
})
