export const preRollSeconds = 0.3

export const batchFrames = 4096

export type CaptureCommand =
  | { type: 'start' | 'stop' | 'cancel'; take: number }
  | { type: 'flush' | 'close' }

export type CaptureBatch = { take: number; samples: Float32Array; done: boolean }

export function sendCommand(node: AudioWorkletNode, command: CaptureCommand): void {
  node.port.postMessage(command)
}

export const captureProcessorSource = `
class PedosCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.ring = new Float32Array(Math.max(1, Math.round(${preRollSeconds} * sampleRate)))
    this.ringAt = 0
    this.ringFilled = 0
    this.take = null
    this.first = null
    this.batch = new Float32Array(${batchFrames})
    this.filled = 0
    this.closed = false
    this.port.onmessage = event => this.receive(event.data)
  }

  receive(command) {
    if (command.type === 'close') {
      this.closed = true
      this.port.onmessage = null
    } else if (command.type === 'flush') {
      this.ringFilled = 0
    } else if (command.type === 'start') {
      this.take = command.take
      this.first = this.preRoll()
      this.filled = 0
    } else if (command.take === this.take) {
      if (command.type === 'stop') {
        const rest = this.first ?? this.batch.slice(0, this.filled)
        this.port.postMessage({ take: this.take, samples: rest, done: true })
      }
      this.take = null
      this.first = null
      this.filled = 0
    }
  }

  /** The ring's audio, oldest first. */
  preRoll() {
    const out = new Float32Array(this.ringFilled)
    const start = (this.ringAt - this.ringFilled + this.ring.length) % this.ring.length
    const head = Math.min(this.ringFilled, this.ring.length - start)
    out.set(this.ring.subarray(start, start + head))
    out.set(this.ring.subarray(0, this.ringFilled - head), head)
    return out
  }

  remember(channel) {
    for (let i = 0; i < channel.length; i++) {
      this.ring[this.ringAt] = channel[i]
      this.ringAt = (this.ringAt + 1) % this.ring.length
    }
    this.ringFilled = Math.min(this.ring.length, this.ringFilled + channel.length)
  }

  process(inputs) {
    if (this.closed) return false
    const channel = inputs[0] && inputs[0][0]
    if (!channel) return true
    if (this.take !== null && this.first) {
      const samples = new Float32Array(this.first.length + channel.length)
      samples.set(this.first)
      samples.set(channel, this.first.length)
      this.port.postMessage({ take: this.take, samples, done: false })
      this.first = null
    } else if (this.take !== null) {
      let read = 0
      while (read < channel.length) {
        const n = Math.min(channel.length - read, this.batch.length - this.filled)
        this.batch.set(channel.subarray(read, read + n), this.filled)
        this.filled += n
        read += n
        if (this.filled === this.batch.length) {
          this.port.postMessage({ take: this.take, samples: this.batch.slice(), done: false })
          this.filled = 0
        }
      }
    }
    this.remember(channel)
    return true
  }
}
registerProcessor('pedos-capture', PedosCapture)
`
