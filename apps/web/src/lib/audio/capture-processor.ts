/** How much audio from before the tap a take starts with, while the microphone is open. */
export const preRollSeconds = 0.3

/** Takes after the first arrive in batches of this many frames. */
export const batchFrames = 4096

/** What the page tells the capture processor. `take` numbers each take. */
export type CaptureCommand = { type: 'start' | 'stop' | 'cancel'; take: number }

/** What the capture processor sends back: a batch of a take's samples, the last one `done`. */
export type CaptureBatch = { take: number; samples: Float32Array; done: boolean }

/**
 * The AudioWorklet that captures the microphone, as source text, because a worklet module loads
 * from a URL. It runs on the audio thread, so a busy page can't drop samples the way a
 * ScriptProcessorNode can.
 *
 * While the microphone is open it keeps the last `preRollSeconds` of audio in a ring, in memory
 * only. A take starts with that ring, so a fart that starts as the person taps is kept whole.
 * The first batch goes out in the first render quantum after `start`, so the page knows capture
 * has begun; later batches are `batchFrames` long. `stop` sends the rest, marked `done`.
 */
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
    this.port.onmessage = event => this.receive(event.data)
  }

  receive(command) {
    if (command.type === 'start') {
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
