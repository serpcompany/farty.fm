import { vi } from 'vitest'
import type { CaptureBatch, CaptureCommand } from '@/lib/audio/capture-processor'
import {
  type CaptureProcessor,
  captureSampleRate,
  newCaptureProcessor,
  renderQuantum
} from './capture-processor'

const quietRoomNoise = 0.001
const audioThreadIntervalMs = 3

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
  readonly processor: CaptureProcessor
  stream: FakeStream | null = null
  running = true

  constructor(readonly context: FakeContext) {
    const processor = newCaptureProcessor(data =>
      queueMicrotask(() => this.port.onmessage?.({ data } as MessageEvent<CaptureBatch>))
    )
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
    const input = live ? [Float32Array.from({ length: renderQuantum }, () => quietRoomNoise)] : []
    this.running = this.processor.process([input])
  }

  connect<T>(next: T): T {
    return next
  }
  disconnect() {}
}

class FakeContext extends EventTarget {
  state: AudioContextState = 'suspended'
  readonly sampleRate = captureSampleRate
  currentTime = 0
  renders = true
  readonly nodes: FakeNode[] = []
  readonly destination = {}
  readonly audioWorklet = { addModule: async (_: string) => {} }

  constructor() {
    super()
    microphoneWorld.contexts.push(this)
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

  renderOneQuantum() {
    if (this.state !== 'running' || !this.renders) return
    this.currentTime += renderQuantum / captureSampleRate
    for (const node of this.nodes) node.render()
  }
}

export const microphoneWorld = {
  contexts: [] as FakeContext[],
  streams: [] as FakeStream[],
  breakNext: null as null | ((stream: FakeStream, context: FakeContext) => void)
}

export function stubMicrophoneBrowser(): void {
  microphoneWorld.contexts = []
  microphoneWorld.streams = []
  microphoneWorld.breakNext = null
  vi.stubGlobal('AudioContext', FakeContext)
  vi.stubGlobal('AudioWorkletNode', FakeNode)
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: vi.fn(async () => {
        const stream = new FakeStream()
        microphoneWorld.streams.push(stream)
        const context = microphoneWorld.contexts.at(-1)
        if (microphoneWorld.breakNext && context) microphoneWorld.breakNext(stream, context)
        return stream
      })
    },
    permissions: { query: async () => ({ state: 'prompt' }) }
  })
  setInterval(() => {
    for (const context of microphoneWorld.contexts) context.renderOneQuantum()
  }, audioThreadIntervalMs)
}
