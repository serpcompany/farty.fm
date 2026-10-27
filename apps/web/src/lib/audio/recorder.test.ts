import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { errorName } from '@/lib/telemetry/report'
import { type CaptureBatch, type CaptureCommand, captureProcessorSource } from './capture-processor'

// The recorder against a stand-in for the browser: getUserMedia, an AudioContext whose clock the
// test runs, and the shipped capture processor on that clock. A pipeline is broken in either of the
// two ways that could leave a take without its first batch, as on the owner's iPhone (#247): the
// context's clock stops, or the stream feeds the graph nothing while its track says it's live.

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

async function recorder() {
  vi.resetModules()
  return import('./recorder')
}

beforeEach(() => {
  vi.useFakeTimers()
  world.contexts = []
  world.streams = []
  world.breakNext = null
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

/** Taps Record: the take, or the error the tap shows. */
async function tap(startTake: (onInterrupted: () => void) => Promise<unknown>) {
  const started = startTake(() => {}).then(
    take => ({ take, error: null }),
    (error: Error) => ({ take: null, error })
  )
  await vi.advanceTimersByTimeAsync(3500)
  return started
}

describe('a take whose pipeline sends no audio', () => {
  it('opens a fresh stream on the next tap when the stream fed the graph nothing', async () => {
    const { startTake } = await recorder()
    world.breakNext = stream => {
      stream.feeds = false
    }
    const first = await tap(startTake)
    expect(first.error?.message).toBe('No audio from the microphone')
    // The error report keeps which: the clock ran, so the stream fed nothing.
    expect(errorName(first.error?.name)).toBe('NoAudioRunningClockRan')

    world.breakNext = null
    const second = await tap(startTake)
    expect(second.error).toBeNull()
    expect(second.take).not.toBeNull()
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2)
    expect(world.streams[0].track.readyState).toBe('ended')
  })

  it('starts a fresh context on the next tap when the context’s clock stopped', async () => {
    const { startTake } = await recorder()
    world.breakNext = (_, context) => {
      context.renders = false
    }
    const first = await tap(startTake)
    expect(first.error?.message).toBe('No audio from the microphone')
    expect(errorName(first.error?.name)).toBe('NoAudioRunningClockStopped')

    world.breakNext = null
    const second = await tap(startTake)
    expect(second.error).toBeNull()
    expect(second.take).not.toBeNull()
    expect(world.contexts).toHaveLength(2)
    expect(world.contexts[0].state).toBe('closed')
  })

  it('keeps the microphone and context when the take starts', async () => {
    const { startTake } = await recorder()
    const first = (await tap(startTake)) as { take: { cancel(): void } | null }
    expect(first.take).not.toBeNull()
    first.take?.cancel()
    const second = await tap(startTake)
    expect(second.take).not.toBeNull()
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce()
    expect(world.contexts).toHaveLength(1)
  })
})
