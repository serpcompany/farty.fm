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
  /** A call or another app took the microphone and ended the track. */
  ended: boolean
  /**
   * The track is muted: by Siri, an alarm or a call banner on iPhone, or by iPhone Safari while
   * the page is hidden. Capture goes on when it unmutes; until then the next tap opens it afresh.
   */
  silenced: boolean
  /**
   * Capture went on with this stream after an interruption or a hidden page, rather than with a
   * fresh one, and no take has run on it since. The next take checks it hears something.
   */
  resumed: boolean
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
/** The microphone opened in this page, so this page was granted it. */
let granted = false
/**
 * The browser said the microphone was granted before this page asked for it, so the grant is
 * the browser's own, such as Safari's per-site Microphone setting at Allow, and doesn't lapse.
 */
let remembered = false
/**
 * When capture last stopped, by `Date.now()`, or null while it runs. iPhone Safari keeps a page's
 * grant for 24 hours while capture runs. Once it stops, a `getUserMedia` call outside a tap asks
 * again after 1 minute, and any call asks again after 10 (#222). A muted track counts as stopped.
 */
let captureStoppedAt: number | null = null
let capturing: Capturing | null = null
let takes = 0
/** The microphone stays open for the rest of the launch (`keepMicrophoneOpen`). */
let keeping = false

/** A take that hasn't sent its first batch by now, with the microphone open, didn't start. */
const firstBatchTimeoutMs = 3000
/**
 * How long after capture stops the page still opens the microphone without a tap: inside iPhone
 * Safari's 1 minute, with room for a slow `getUserMedia`. After it, the next Record tap opens it.
 */
export const openWithoutTapMs = 50_000
/**
 * How long a hidden page's microphone may keep listening before it's let go. iPhone Safari mutes
 * it as the page hides, so the stream is kept; a browser that keeps listening loses it.
 */
const hiddenListeningMs = 1000
/** How long the page waits, once shown, for a muted track to unmute before opening it afresh. */
const unmuteWaitMs = 1500

/** Each context's load of the capture processor, shared by Record's preload and the first tap. */
const loads = new WeakMap<BaseAudioContext, Promise<void>>()

function loadCaptureProcessor(context: AudioContext): Promise<void> {
  const loaded = loads.get(context)
  if (loaded) return loaded
  // Async, so a browser without `audioWorklet` rejects rather than throws.
  const loading = (async () => {
    const url = URL.createObjectURL(new Blob([captureProcessorSource], { type: 'text/javascript' }))
    try {
      await context.audioWorklet.addModule(url)
    } finally {
      URL.revokeObjectURL(url)
    }
  })()
  loads.set(context, loading)
  // A load that failed is tried again by the next caller.
  loading.catch(() => {
    if (loads.get(context) === loading) loads.delete(context)
  })
  return loading
}

async function permissionGranted(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName })
    return status.state === 'granted'
  } catch {
    return false
  }
}

/**
 * Whether the microphone can open now, outside a tap, without the browser asking: the browser
 * remembers the grant, or this page's own grant is still good outside a tap, because capture ran
 * less than `openWithoutTapMs` ago. Otherwise the next Record tap opens it.
 */
async function mayOpenWithoutTap(): Promise<boolean> {
  if (!granted && !remembered) {
    const allowed = await permissionGranted()
    // iPhone Safari also says granted while the page's own grant lasts, so only an answer from
    // before this page was granted the microphone counts as the browser's.
    if (allowed && !granted) remembered = true
  }
  if (remembered) return true
  return granted && (captureStoppedAt === null || Date.now() - captureStoppedAt <= openWithoutTapMs)
}

function captureStarted(): void {
  captureStoppedAt = null
}

function captureStopped(): void {
  captureStoppedAt ??= Date.now()
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
  captureStarted()
  // An interruption is heard from the moment the stream opens. One that comes while the capture
  // processor loads, which takes longest on a slow phone, is heard by the next tap too (#172).
  let mutedWhileOpening = false
  let endedWhileOpening = false
  for (const track of stream.getAudioTracks()) {
    track.onmute = () => {
      mutedWhileOpening = true
      captureStopped()
    }
    track.onunmute = () => {
      mutedWhileOpening = false
      captureStarted()
    }
    track.onended = () => {
      endedWhileOpening = true
      captureStopped()
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
    captureStopped()
    if (openedIn === generation) setMicrophoneSession(false)
    throw error
  }

  const source = context.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(context, 'pedos-capture')
  // The node has to reach the destination to be pulled; the gain keeps the mic off the speaker.
  const mute = context.createGain()
  mute.gain.value = 0
  source.connect(node).connect(mute).connect(context.destination)
  // An interruption on iPhone, or hiding the page there, mutes the track or stops the context
  // without ending it. The ring would then hold silence, or audio from before it, so it's
  // emptied. Capture goes on with the same stream once the track unmutes and a tap starts the
  // context again (#222).
  let running = context.state === 'running'
  const contextChanged = () => {
    if (running && context.state !== 'running') send(node, { type: 'flush' })
    running = context.state === 'running'
  }
  context.addEventListener('statechange', contextChanged)
  const opened: Microphone = {
    context,
    stream,
    source,
    node,
    mute,
    ended: endedWhileOpening,
    silenced: mutedWhileOpening,
    resumed: false,
    unwatch: () => context.removeEventListener('statechange', contextChanged)
  }

  node.port.onmessage = (event: MessageEvent<CaptureBatch>) => {
    const take = capturing
    if (!take || event.data.take !== take.id) return
    take.chunks.push(event.data.samples)
    take.began()
    if (event.data.done) take.finished?.()
  }
  for (const track of stream.getAudioTracks()) {
    // A call or another app taking the microphone ends the track: a take in progress is lost.
    track.onended = () => {
      opened.ended = true
      captureStopped()
      if (microphone === opened) releaseMicrophone()
    }
    track.onmute = () => {
      opened.silenced = true
      captureStopped()
      send(node, { type: 'flush' })
    }
    track.onunmute = () => {
      if (microphone !== opened) return
      if (document.visibilityState === 'hidden') {
        // Never listening while hidden: the interruption ended while the person is away. The
        // stream is let go unless the page shows within `hiddenListeningMs`, since iPhone Safari
        // may unmute it just before it says the page shows.
        opened.silenced = false
        releaseIfHiddenAndListening()
      } else resumeCapture(opened)
    }
  }
  return opened
}

/** The track unmuted: what the ring heard before it is stale, and the stream is good again. */
function resumeCapture(mic: Microphone): void {
  mic.silenced = false
  mic.resumed = true
  captureStarted()
  send(mic.node, { type: 'flush' })
}

/** All of a take's first batch is exact zeros: a microphone delivers noise, never that. */
function digitalSilence(samples: Float32Array): boolean {
  return samples.every(sample => sample === 0)
}

/** The track is muted, so the stream hears nothing until it unmutes. */
function silent(mic: Microphone): boolean {
  return mic.silenced || mic.stream.getAudioTracks().some(track => track.muted)
}

function ended(mic: Microphone): boolean {
  return mic.ended || mic.stream.getAudioTracks().some(track => track.readyState === 'ended')
}

/** Whether an interruption has left the open microphone unable to capture. */
function interrupted(mic: Microphone): boolean {
  return ended(mic) || silent(mic)
}

/** Loses the take in progress, if any: one still starting fails, and one recording stops. */
function loseTake(): void {
  const lost = capturing
  if (!lost) return
  capturing = null
  if (microphone) send(microphone.node, { type: 'cancel', take: lost.id })
  lost.lost()
}

/**
 * Closes the microphone and puts the audio session back to playback. A take in progress is lost,
 * and one still opening the microphone fails.
 */
export function releaseMicrophone(): void {
  generation += 1
  const wasOpen = microphone !== null || opening !== null
  opening = null
  loseTake()
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
    for (const track of closing.stream.getTracks()) {
      track.onmute = track.onunmute = track.onended = null
      track.stop()
    }
  }
  if (wasOpen) captureStopped()
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
  if (interrupted(mic) && !capturing) {
    releaseMicrophone()
    mic = await openMicrophone()
  }
  const resumed = mic.resumed
  mic.resumed = false
  const take = await capture(mic, onInterrupted)
  // A stream kept through an interruption may come back sending digital silence (#172, #222).
  // Its first take then opens it afresh, in the same tap, rather than recording nothing.
  if (resumed && digitalSilence(take.first) && microphone === mic) {
    take.cancel()
    releaseMicrophone()
    return capture(await openMicrophone(), onInterrupted)
  }
  return take
}

/** Starts a take on `mic`. It resolves with the take, and its first batch, once audio comes in. */
async function capture(
  mic: Microphone,
  onInterrupted: () => void
): Promise<Take & { first: Float32Array }> {
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
    first: take.chunks[0],
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
 * its pre-roll. Sounds meanwhile play in the microphone's session (`setPlaybackSession`).
 *
 * It opens without a tap only while that can't make the browser ask (`mayOpenWithoutTap`);
 * otherwise the next tap opens it. Hiding the page keeps the stream, which iPhone Safari mutes
 * until the page shows again, so iPhone doesn't count capture as stopped for good and ask again
 * (#222). A browser that would keep listening while the page is hidden lets it go instead. A
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
  void openIfAllowed()
}

let computer: MediaQueryList | null = null
let hiddenTimer: ReturnType<typeof setTimeout> | undefined
let shownTimer: ReturnType<typeof setTimeout> | undefined

/** A window widened into the product page lets the microphone go. */
function becameComputer(event: MediaQueryListEvent): void {
  if (!event.matches) return
  keeping = false
  clearTimeout(hiddenTimer)
  clearTimeout(shownTimer)
  computer?.removeEventListener('change', becameComputer)
  document.removeEventListener('visibilitychange', visibilityChanged)
  window.removeEventListener('pagehide', releaseMicrophone)
  releaseMicrophone()
}

function visibilityChanged(): void {
  clearTimeout(hiddenTimer)
  clearTimeout(shownTimer)
  if (document.visibilityState === 'hidden') pageHidden()
  else pageShown()
}

function pageHidden(): void {
  // The person left: a take in progress is lost, and one opening the microphone stops.
  if (opening) releaseMicrophone()
  loseTake()
  // Safari may stop capture before it says so; the clock starts now either way.
  captureStopped()
  releaseIfHiddenAndListening()
}

/**
 * In `hiddenListeningMs`, lets the microphone go if the page is still hidden and its stream could
 * hear: as the page hides, and again if a muted stream unmutes before it shows.
 */
function releaseIfHiddenAndListening(): void {
  clearTimeout(hiddenTimer)
  hiddenTimer = setTimeout(() => {
    const mic = microphone
    if (document.visibilityState !== 'hidden' || !mic) return
    if (!interrupted(mic)) releaseMicrophone()
  }, hiddenListeningMs)
}

function pageShown(): void {
  const mic = microphone
  if (!mic || ended(mic)) {
    if (mic) releaseMicrophone()
    void openIfAllowed()
    return
  }
  if (!silent(mic)) {
    resumeCapture(mic)
    return
  }
  // iPhone Safari unmutes the track once the page shows (`resumeCapture`). One that stays muted
  // is opened afresh, if that can't make the browser ask.
  shownTimer = setTimeout(() => {
    if (microphone !== mic || !silent(mic) || document.visibilityState !== 'visible') return
    releaseMicrophone()
    void openIfAllowed()
  }, unmuteWaitMs)
}

async function openIfAllowed(): Promise<void> {
  if (!(await mayOpenWithoutTap())) {
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
  captureStoppedAt = Date.now()
}
