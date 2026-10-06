import type { PcmAudio } from '@/lib/wav'
import { audioContext, setAudioSession } from './context'

/** A take in progress. `stop` returns the raw microphone audio; `cancel` throws it away. */
export type Take = {
  stop(): Promise<PcmAudio>
  cancel(): void
}

export class MicrophoneDeniedError extends Error {}

/**
 * Copies the microphone's samples to the page in 4096-frame batches. An AudioWorklet runs on the
 * audio thread, so a busy page can't drop samples the way a ScriptProcessorNode can.
 */
const captureProcessor = `
class PedosCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.batch = new Float32Array(4096)
    this.filled = 0
    this.port.onmessage = () => {
      this.port.postMessage({ samples: this.batch.slice(0, this.filled), done: true })
      this.filled = 0
    }
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (!channel) return true
    let read = 0
    while (read < channel.length) {
      const n = Math.min(channel.length - read, this.batch.length - this.filled)
      this.batch.set(channel.subarray(read, read + n), this.filled)
      this.filled += n
      read += n
      if (this.filled === this.batch.length) {
        this.port.postMessage({ samples: this.batch.slice(), done: false })
        this.filled = 0
      }
    }
    return true
  }
}
registerProcessor('pedos-capture', PedosCapture)
`

const loadedContexts = new WeakSet<BaseAudioContext>()

async function loadCaptureProcessor(context: AudioContext): Promise<void> {
  if (loadedContexts.has(context)) return
  const url = URL.createObjectURL(new Blob([captureProcessor], { type: 'text/javascript' }))
  try {
    await context.audioWorklet.addModule(url)
    loadedContexts.add(context)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Opens the microphone and starts capturing. Call it from a tap: Safari only starts audio then.
 * The browser's voice processing is turned off, because echo cancellation, noise suppression and
 * gain control would bend the pitch and level of the fart.
 */
export async function startTake(onInterrupted: () => void): Promise<Take> {
  const context = audioContext()
  setAudioSession('play-and-record')
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    })
  } catch (error) {
    setAudioSession('playback')
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      throw new MicrophoneDeniedError()
    }
    throw error
  }

  try {
    await context.resume()
    await loadCaptureProcessor(context)
  } catch (error) {
    release(stream)
    throw error
  }

  const source = context.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(context, 'pedos-capture')
  // The node has to reach the destination to be pulled; the gain keeps the mic off the speaker.
  const mute = context.createGain()
  mute.gain.value = 0
  source.connect(node).connect(mute).connect(context.destination)

  const chunks: Float32Array[] = []
  let finish: (() => void) | null = null
  node.port.onmessage = (event: MessageEvent<{ samples: Float32Array; done: boolean }>) => {
    chunks.push(event.data.samples)
    if (event.data.done) finish?.()
  }

  let ended = false
  const end = () => {
    if (ended) return false
    ended = true
    source.disconnect()
    node.disconnect()
    mute.disconnect()
    release(stream)
    return true
  }
  // A call or another app taking the microphone ends the track: the take is lost.
  for (const track of stream.getAudioTracks()) {
    track.onended = () => {
      if (end()) onInterrupted()
    }
  }

  return {
    async stop() {
      // Ask the processor for its last partial batch before letting go of the microphone.
      await new Promise<void>(resolve => {
        finish = resolve
        node.port.postMessage('flush')
        setTimeout(resolve, 500)
      })
      end()
      const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
      const samples = new Float32Array(length)
      let at = 0
      for (const chunk of chunks) {
        samples.set(chunk, at)
        at += chunk.length
      }
      return { samples, sampleRate: context.sampleRate }
    },
    cancel() {
      end()
    }
  }
}

function release(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop()
  setAudioSession('playback')
}
