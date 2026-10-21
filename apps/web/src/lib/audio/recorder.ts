import type { PcmAudio } from '@/lib/wav'
import { type CaptureBatch, type CaptureCommand, captureProcessorSource } from './capture-processor'
import { audioContext, setAudioSession } from './context'

/** A take in progress. `stop` returns the raw microphone audio; `cancel` throws it away. */
export type Take = {
  stop(): Promise<PcmAudio>
  cancel(): void
}

export class MicrophoneDeniedError extends Error {}

/** The microphone was let go, by `releaseMicrophone`, before the take began. */
export class MicrophoneReleasedError extends Error {}

/** An open microphone: one stream, source and capture node, kept between takes. */
type Microphone = {
  context: AudioContext
  stream: MediaStream
  source: MediaStreamAudioSourceNode
  node: AudioWorkletNode
  mute: GainNode
}

/** A take being captured, with what's waiting on it. */
type Capturing = {
  id: number
  chunks: Float32Array[]
  began(): void
  finished: (() => void) | null
  lost(): void
}

let microphone: Microphone | null = null
let opening: Promise<Microphone> | null = null
/** Counts `releaseMicrophone` calls, so a microphone that opens after one is let go at once. */
let generation = 0
/** The microphone opened in this page, so permission was granted. */
let granted = false
let capturing: Capturing | null = null
let takes = 0

/** A take that hasn't sent its first batch by now, with the microphone open, didn't start. */
const firstBatchTimeoutMs = 3000

const loadedContexts = new WeakSet<BaseAudioContext>()

async function loadCaptureProcessor(context: AudioContext): Promise<void> {
  if (loadedContexts.has(context)) return
  const url = URL.createObjectURL(new Blob([captureProcessorSource], { type: 'text/javascript' }))
  try {
    await context.audioWorklet.addModule(url)
    loadedContexts.add(context)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Whether the microphone can open without asking: it opened in this page already, or the
 * Permissions API says it's granted. Where the browser can't tell, it asks on the first tap.
 */
export async function microphoneGranted(): Promise<boolean> {
  if (granted) return true
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName })
    return status.state === 'granted'
  } catch {
    return false
  }
}

/**
 * Opens the microphone, or returns the one that's open or opening. It stays open between takes
 * until `releaseMicrophone`. The browser's voice processing is turned off, because echo
 * cancellation, noise suppression and gain control would bend the pitch and level of the fart.
 */
export function openMicrophone(): Promise<Microphone> {
  if (microphone) return Promise.resolve(microphone)
  if (!opening) {
    const thisOpening = connect(generation)
    opening = thisOpening
    thisOpening.then(
      opened => {
        if (opening === thisOpening) {
          opening = null
          microphone = opened
        }
      },
      () => {
        if (opening === thisOpening) opening = null
      }
    )
  }
  return opening
}

async function connect(openedIn: number): Promise<Microphone> {
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
    if (openedIn !== generation) throw new MicrophoneReleasedError()
    setAudioSession('playback')
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      throw new MicrophoneDeniedError()
    }
    throw error
  }
  granted = true

  try {
    if (openedIn !== generation) throw new MicrophoneReleasedError()
    // Outside a tap this may not start the context; the next Record tap does.
    context.resume().catch(() => {})
    await loadCaptureProcessor(context)
    if (openedIn !== generation) throw new MicrophoneReleasedError()
  } catch (error) {
    for (const track of stream.getTracks()) track.stop()
    if (openedIn === generation) setAudioSession('playback')
    throw error
  }

  const source = context.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(context, 'pedos-capture')
  // The node has to reach the destination to be pulled; the gain keeps the mic off the speaker.
  const mute = context.createGain()
  mute.gain.value = 0
  source.connect(node).connect(mute).connect(context.destination)
  const opened: Microphone = { context, stream, source, node, mute }

  node.port.onmessage = (event: MessageEvent<CaptureBatch>) => {
    const take = capturing
    if (!take || event.data.take !== take.id) return
    take.chunks.push(event.data.samples)
    take.began()
    if (event.data.done) take.finished?.()
  }
  // A call or another app taking the microphone ends the track: a take in progress is lost.
  for (const track of stream.getAudioTracks()) {
    track.onended = () => {
      if (microphone === opened) releaseMicrophone()
    }
  }
  return opened
}

/**
 * Closes the microphone and puts the audio session back to playback, so sound plays at full
 * volume on iPhone. A take in progress is lost, and one still opening the microphone fails.
 */
export function releaseMicrophone(): void {
  generation += 1
  opening = null
  const lost = capturing
  capturing = null
  lost?.lost()
  const closing = microphone
  microphone = null
  if (closing) {
    closing.source.disconnect()
    closing.node.disconnect()
    closing.mute.disconnect()
    closing.node.port.onmessage = null
    for (const track of closing.stream.getTracks()) track.stop()
  }
  setAudioSession('playback')
}

function send(node: AudioWorkletNode, command: CaptureCommand): void {
  node.port.postMessage(command)
}

/**
 * Starts a take on the open microphone, opening it first if it isn't. Call it from a tap: Safari
 * only starts audio then. It resolves once the first batch arrives, so audio is being captured,
 * and the take begins with the pre-roll from before the tap. `onInterrupted` runs if the
 * microphone is lost during the take.
 */
export async function startTake(onInterrupted: () => void): Promise<Take> {
  // Before the first await, so it counts as part of the tap.
  audioContext()
    .resume()
    .catch(() => {})
  const mic = await openMicrophone()

  takes += 1
  const id = takes
  let begin = () => {}
  let fail = (_: Error) => {}
  const started = new Promise<void>((resolve, reject) => {
    begin = resolve
    fail = reject
  })
  let inProgress = false
  const take: Capturing = {
    id,
    chunks: [],
    began: () => begin(),
    finished: null,
    lost: () => {
      if (inProgress) onInterrupted()
      else fail(new MicrophoneReleasedError())
    }
  }
  capturing = take
  send(mic.node, { type: 'start', take: id })

  const timeout = setTimeout(
    () => fail(new Error('No audio from the microphone')),
    firstBatchTimeoutMs
  )
  try {
    await started
  } catch (error) {
    if (capturing === take) {
      capturing = null
      send(mic.node, { type: 'cancel', take: id })
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
  inProgress = true

  return {
    async stop() {
      if (capturing === take) {
        // Ask the processor for its last partial batch.
        await new Promise<void>(resolve => {
          take.finished = resolve
          send(mic.node, { type: 'stop', take: id })
          setTimeout(resolve, 500)
        })
        if (capturing === take) capturing = null
      }
      const length = take.chunks.reduce((sum, chunk) => sum + chunk.length, 0)
      const samples = new Float32Array(length)
      let at = 0
      for (const chunk of take.chunks) {
        samples.set(chunk, at)
        at += chunk.length
      }
      return { samples, sampleRate: mic.context.sampleRate }
    },
    cancel() {
      if (capturing !== take) return
      capturing = null
      send(mic.node, { type: 'cancel', take: id })
    }
  }
}

/**
 * Keeps the microphone open while the Record screen shows, so a tap starts capturing at once and
 * the take has its pre-roll. It opens only when permission is already granted, so Pedos doesn't
 * ask as soon as it opens; otherwise the first tap opens it. Hiding the page lets it go, and
 * showing the page again opens it. Returns the function that lets it go.
 */
export function keepMicrophoneOpen(): () => void {
  let kept = true
  const open = async () => {
    if (!(await microphoneGranted())) return
    if (kept && document.visibilityState === 'visible') openMicrophone().catch(() => {})
  }
  const visibilityChanged = () => {
    if (document.visibilityState === 'hidden') releaseMicrophone()
    else void open()
  }
  void open()
  document.addEventListener('visibilitychange', visibilityChanged)
  window.addEventListener('pagehide', releaseMicrophone)
  return () => {
    kept = false
    document.removeEventListener('visibilitychange', visibilityChanged)
    window.removeEventListener('pagehide', releaseMicrophone)
    releaseMicrophone()
  }
}
