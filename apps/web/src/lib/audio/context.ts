/**
 * One AudioContext for recording and playback. iPhone Safari allows only a few, so the app makes
 * one and keeps it. Record may make it before a tap, to load the capture processor, but it starts
 * only from a tap: Record, Play, or one that opens a screen which plays (`startAudioInTap`).
 */
let shared: AudioContext | null = null

export function audioContext(): AudioContext {
  if (!shared || shared.state === 'closed') shared = new AudioContext()
  return shared
}

/**
 * Closes `context` if it's the shared one, so the next `audioContext()` makes a new one: after it
 * stopped bringing in the microphone (`recorder.ts`).
 */
export function replaceAudioContext(context: AudioContext): void {
  if (shared !== context) return
  shared = null
  context.close().catch(() => {})
}

/**
 * Starts the shared AudioContext inside a tap that opens a screen which plays by itself after an
 * await, such as Song Creator. iPhone Safari starts a context only while it handles a tap, so the
 * screen's later play finds it running.
 */
export function startAudioInTap(): void {
  setPlaybackSession()
  audioContext()
    .resume()
    .catch(() => {})
}

type AudioSessionType = 'auto' | 'playback' | 'play-and-record'

/** The microphone is open or opening (`recorder.ts`), so the session stays "play-and-record". */
let microphoneOpen = false

/** Sets the session for the microphone: "play-and-record" while it's open, "playback" after. */
export function setMicrophoneSession(open: boolean): void {
  microphoneOpen = open
  setAudioSession(open ? 'play-and-record' : 'playback')
}

/**
 * Sets the session for a sound about to play: "playback", unless the microphone is open. Then it
 * stays "play-and-record", because switching would mute the microphone on iPhone.
 */
export function setPlaybackSession(): void {
  if (!microphoneOpen) setAudioSession('playback')
}

/**
 * Safari's Audio Session API (iOS 16.4+). "playback" makes Web Audio play with the ring/silent
 * switch on, which Safari otherwise mutes; "play-and-record" is needed while the mic is open. The
 * mic stays open from the first time Record shows to the end of the launch (`keepMicrophoneOpen`),
 * so from then on every sound plays in "play-and-record". Other browsers don't have it and need
 * neither.
 */
function setAudioSession(type: AudioSessionType): void {
  const session = (navigator as Navigator & { audioSession?: { type: AudioSessionType } })
    .audioSession
  if (session) session.type = type
}
