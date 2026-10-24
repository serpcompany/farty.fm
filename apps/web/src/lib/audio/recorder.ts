import { desktop } from '@/lib/desktop'
import type { PcmAudio } from '@/lib/wav'
import { type CaptureBatch, type CaptureCommand, captureProcessorSource } from './capture-processor'
import { audioContext, setMicrophoneSession } from './context'

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
  /** An interruption muted the track or stopped the context, so the next tap opens it afresh. */
  interrupted: boolean
  /** Stops listening to the shared context. */
  unwatch(): void
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
/** The microphone stays open for the rest of the launch (`keepMicrophoneOpen`). */
let keeping = false

/** A take that hasn't sent its first batch by now, with the microphone open, didn't start. */
const firstBatchTimeoutMs = 3000

/** Each context's load of the capture processor, shared by Record's preload and the first tap. */
const loads = new WeakMap<BaseAudioContext, Promise<void>>()

function loadCaptureProcessor(context: AudioContext): Promise<void> {
  const loaded = loads.get(context)
  if (loaded) return loaded
  const url = URL.createObjectURL(new Blob([captureProcessorSource], { type: 'text/javascript' }))
  const loading = context.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url))
  loads.set(context, loading)
  // A load that failed is tried again by the next caller.
  loading.catch(() => {
    if (loads.get(context) === loading) loads.delete(context)
  })
  return loading
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

const microphoneConstraints: MediaStreamConstraints = {
  audio: {
    channelCount: 1,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false
  }
}

async function connect(openedIn: number): Promise<Microphone> {
  const context = audioContext()
  setMicrophoneSession(true)
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia(microphoneConstraints)
  } catch (error) {
    if (openedIn !== generation) throw new MicrophoneReleasedError()
    setMicrophoneSession(false)
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      throw new MicrophoneDeniedError()
    }
    throw error
  }
  granted = true
  // An interruption is heard from the moment the stream opens. One that comes while the capture
  // processor loads, which takes longest on a slow phone, opens the microphone afresh too (#172).
  let interruptedWhileOpening = false
  for (const track of stream.getAudioTracks()) {
    track.onmute = track.onended = () => {
      interruptedWhileOpening = true
    }
  }

  try {
    if (openedIn !== generation) throw new MicrophoneReleasedError()
    // Outside a tap this may not start the context; the next Record tap does.
    context.resume().catch(() => {})
    await loadCaptureProcessor(context)
    if (openedIn !== generation) throw new MicrophoneReleasedError()
  } catch (error) {
    for (const track of stream.getTracks()) track.stop()
    if (openedIn === generation) setMicrophoneSession(false)
    throw error
  }

  const source = context.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(context, 'pedos-capture')
  // The node has to reach the destination to be pulled; the gain keeps the mic off the speaker.
  const mute = context.createGain()
  mute.gain.value = 0
  source.connect(node).connect(mute).connect(context.destination)
  // Siri, an alarm or a call banner on iPhone mutes the track, or stops the context, without
  // ending it. The ring would then hold silence, or audio from before the interruption, so it's
  // emptied, and the next tap opens the microphone afresh.
  const interrupt = () => {
    opened.interrupted = true
    send(node, { type: 'flush' })
  }
  let running = context.state === 'running'
  const contextChanged = () => {
    if (running && context.state !== 'running') interrupt()
    running = context.state === 'running'
  }
  context.addEventListener('statechange', contextChanged)
  const opened: Microphone = {
    context,
    stream,
    source,
    node,
    mute,
    interrupted: interruptedWhileOpening,
    unwatch: () => context.removeEventListener('statechange', contextChanged)
  }

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
    track.onmute = interrupt
  }
  return opened
}

/** Whether an interruption has left the open microphone's track silent or its ring stale. */
function interrupted(mic: Microphone): boolean {
  return mic.interrupted || mic.stream.getAudioTracks().some(track => track.muted)
}

/**
 * Closes the microphone and puts the audio session back to playback. A take in progress is lost,
 * and one still opening the microphone fails.
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
    closing.unwatch()
    // Ends the processor, which would otherwise run on the audio thread until the page closes.
    send(closing.node, { type: 'close' })
    closing.source.disconnect()
    closing.node.disconnect()
    closing.mute.disconnect()
    closing.node.port.onmessage = null
    for (const track of closing.stream.getTracks()) track.stop()
  }
  setMicrophoneSession(false)
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
  if (microphone && !capturing && interrupted(microphone)) releaseMicrophone()
  let mic = await openMicrophone()
  // Tapped while it was opening, and interrupted then.
  if (mic.interrupted && !capturing) {
    releaseMicrophone()
    mic = await openMicrophone()
  }

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
 * Keeps the microphone open for the rest of the launch, from the first time the Record screen
 * shows: through Review, Result and the other tabs, so every tap on Record captures at once with
 * its pre-roll. Sounds meanwhile play in the microphone's session (`setPlaybackSession`). It opens
 * only when permission is already granted, so Farty doesn't ask as soon as it opens; otherwise
 * the first tap opens it. Hiding the page lets it go, and showing the page again opens it. A
 * computer's product page lets it go until Record shows again (#199).
 */
export function keepMicrophoneOpen(): void {
  if (window.matchMedia(desktop).matches) return
  if (!keeping) {
    keeping = true
    computer = window.matchMedia(desktop)
    computer.addEventListener('change', becameComputer)
    document.addEventListener('visibilitychange', visibilityChanged)
    window.addEventListener('pagehide', releaseMicrophone)
  }
  void openIfGranted()
}

let computer: MediaQueryList | null = null

/** A window widened into the product page lets the microphone go. */
function becameComputer(event: MediaQueryListEvent): void {
  if (!event.matches) return
  keeping = false
  computer?.removeEventListener('change', becameComputer)
  document.removeEventListener('visibilitychange', visibilityChanged)
  window.removeEventListener('pagehide', releaseMicrophone)
  releaseMicrophone()
}

function visibilityChanged(): void {
  if (document.visibilityState === 'hidden') releaseMicrophone()
  else void openIfGranted()
}

async function openIfGranted(): Promise<void> {
  if (!(await microphoneGranted())) {
    // The first tap then waits only for the microphone. The context stays suspended until a tap.
    loadCaptureProcessor(audioContext()).catch(() => {})
    return
  }
  if (keeping && document.visibilityState === 'visible') openMicrophone().catch(() => {})
}

/**
 * Asks for the microphone before the first take, as Welcome does. Once Record has shown, it opens
 * the microphone and keeps it, so the first tap captures at once with its pre-roll; before that it
 * closes it again. Throws `MicrophoneDeniedError` when the person says no.
 */
export async function askForMicrophone(): Promise<void> {
  if (keeping) {
    await openMicrophone()
    return
  }
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia(microphoneConstraints)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      throw new MicrophoneDeniedError()
    }
    throw error
  }
  for (const track of stream.getTracks()) track.stop()
  granted = true
}
