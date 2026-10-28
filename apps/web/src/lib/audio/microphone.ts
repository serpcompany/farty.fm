import { type CaptureBatch, captureProcessorSource, sendCommand } from './capture-processor'
import { receiveBatch, stopCapturing, takeInProgress } from './capturing'
import { audioContext, setMicrophoneSession } from './context'
import { captureStarted, captureStopped, microphoneGranted } from './microphone-grant'

export type Microphone = {
  context: AudioContext
  stream: MediaStream
  source: MediaStreamAudioSourceNode
  node: AudioWorkletNode
  mute: GainNode
  ended: boolean
  silenced: boolean
  resumed: boolean
  unwatch(): void
}

export class MicrophoneDeniedError extends Error {}

export class MicrophoneReleasedError extends Error {}

let microphone: Microphone | null = null
let opening: Promise<Microphone> | null = null
let releases = 0
let hiddenTimer: ReturnType<typeof setTimeout> | undefined

const hiddenListeningMs = 1000

const microphoneConstraints: MediaStreamConstraints = {
  audio: {
    channelCount: 1,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false
  }
}

const loads = new WeakMap<BaseAudioContext, Promise<void>>()

export function loadCaptureProcessor(context: AudioContext): Promise<void> {
  const loaded = loads.get(context)
  if (loaded) return loaded
  const loading = (async () => {
    const url = URL.createObjectURL(new Blob([captureProcessorSource], { type: 'text/javascript' }))
    try {
      await context.audioWorklet.addModule(url)
    } finally {
      URL.revokeObjectURL(url)
    }
  })()
  loads.set(context, loading)
  loading.catch(() => {
    if (loads.get(context) === loading) loads.delete(context)
  })
  return loading
}

export function currentMicrophone(): Microphone | null {
  return microphone
}

export function microphoneOpening(): boolean {
  return opening !== null
}

export async function getMicrophoneStream(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia(microphoneConstraints)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      throw new MicrophoneDeniedError()
    }
    throw error
  }
}

export function openMicrophone(): Promise<Microphone> {
  if (microphone) return Promise.resolve(microphone)
  if (!opening) {
    const thisOpening = connect(releases)
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
  setMicrophoneSession(true)
  let stream: MediaStream
  try {
    stream = await getMicrophoneStream()
  } catch (error) {
    if (openedIn !== releases) throw new MicrophoneReleasedError()
    setMicrophoneSession(false)
    throw error
  }
  microphoneGranted()
  captureStarted()
  const heardWhileOpening = watchTracksWhileOpening(stream)
  await prepareCapture(context, stream, openedIn)
  const graph = captureGraph(context, stream)
  const opened: Microphone = {
    context,
    stream,
    ...graph,
    ended: heardWhileOpening.ended,
    silenced: heardWhileOpening.muted,
    resumed: false,
    unwatch: flushWhenContextStops(context, graph.node)
  }
  graph.node.port.onmessage = (event: MessageEvent<CaptureBatch>) => receiveBatch(event.data)
  watchTracks(opened)
  return opened
}

function watchTracksWhileOpening(stream: MediaStream): { muted: boolean; ended: boolean } {
  const heard = { muted: false, ended: false }
  for (const track of stream.getAudioTracks()) {
    track.onmute = () => {
      heard.muted = true
      captureStopped()
    }
    track.onunmute = () => {
      heard.muted = false
      captureStarted()
    }
    track.onended = () => {
      heard.ended = true
      captureStopped()
    }
  }
  return heard
}

async function prepareCapture(
  context: AudioContext,
  stream: MediaStream,
  openedIn: number
): Promise<void> {
  try {
    if (openedIn !== releases) throw new MicrophoneReleasedError()
    context.resume().catch(() => {})
    await loadCaptureProcessor(context)
    if (openedIn !== releases) throw new MicrophoneReleasedError()
  } catch (error) {
    for (const track of stream.getTracks()) track.stop()
    captureStopped()
    if (openedIn === releases) setMicrophoneSession(false)
    throw error
  }
}

function captureGraph(context: AudioContext, stream: MediaStream) {
  const source = context.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(context, 'pedos-capture')
  const mute = context.createGain()
  mute.gain.value = 0
  source.connect(node).connect(mute).connect(context.destination)
  return { source, node, mute }
}

function flushWhenContextStops(context: AudioContext, node: AudioWorkletNode): () => void {
  let running = context.state === 'running'
  const contextChanged = () => {
    if (running && context.state !== 'running') sendCommand(node, { type: 'flush' })
    running = context.state === 'running'
  }
  context.addEventListener('statechange', contextChanged)
  return () => context.removeEventListener('statechange', contextChanged)
}

function watchTracks(opened: Microphone): void {
  for (const track of opened.stream.getAudioTracks()) {
    track.onended = () => {
      opened.ended = true
      captureStopped()
      if (microphone === opened) releaseMicrophone()
    }
    track.onmute = () => {
      opened.silenced = true
      captureStopped()
      sendCommand(opened.node, { type: 'flush' })
    }
    track.onunmute = () => {
      if (microphone !== opened) return
      if (document.visibilityState === 'hidden') {
        opened.silenced = false
        releaseIfHiddenAndListening()
      } else resumeCapture(opened)
    }
  }
}

export function resumeCapture(mic: Microphone): void {
  mic.silenced = false
  mic.resumed = true
  captureStarted()
  sendCommand(mic.node, { type: 'flush' })
}

export function silent(mic: Microphone): boolean {
  return mic.silenced || mic.stream.getAudioTracks().some(track => track.muted)
}

export function ended(mic: Microphone): boolean {
  return mic.ended || mic.stream.getAudioTracks().some(track => track.readyState === 'ended')
}

export function interrupted(mic: Microphone): boolean {
  return ended(mic) || silent(mic)
}

export function loseTake(): void {
  const lost = takeInProgress()
  if (!lost) return
  stopCapturing(lost)
  if (microphone) sendCommand(microphone.node, { type: 'cancel', take: lost.id })
  lost.lost()
}

export function releaseMicrophone(): void {
  releases += 1
  const wasOpen = microphone !== null || opening !== null
  opening = null
  loseTake()
  const closing = microphone
  microphone = null
  if (closing) close(closing)
  if (wasOpen) captureStopped()
  setMicrophoneSession(false)
}

function close(closing: Microphone): void {
  closing.unwatch()
  sendCommand(closing.node, { type: 'close' })
  closing.source.disconnect()
  closing.node.disconnect()
  closing.mute.disconnect()
  closing.node.port.onmessage = null
  for (const track of closing.stream.getTracks()) {
    track.onmute = track.onunmute = track.onended = null
    track.stop()
  }
}

export function releaseIfHiddenAndListening(): void {
  clearTimeout(hiddenTimer)
  hiddenTimer = setTimeout(() => {
    const mic = microphone
    if (document.visibilityState !== 'hidden' || !mic) return
    if (!interrupted(mic)) releaseMicrophone()
  }, hiddenListeningMs)
}

export function cancelHiddenRelease(): void {
  clearTimeout(hiddenTimer)
}
