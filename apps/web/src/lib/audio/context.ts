/**
 * One AudioContext for recording and playback. iPhone Safari allows only a few, and each must
 * start from a tap, so the app makes one on the first Record or Play tap and keeps it.
 */
let shared: AudioContext | null = null

export function audioContext(): AudioContext {
  if (!shared || shared.state === 'closed') shared = new AudioContext()
  return shared
}

type AudioSessionType = 'auto' | 'playback' | 'play-and-record'

/**
 * Safari's Audio Session API (iOS 16.4+). "playback" makes Web Audio play with the ring/silent
 * switch on, which Safari otherwise mutes; "play-and-record" is needed while the mic is open.
 * Other browsers don't have it and need neither.
 */
export function setAudioSession(type: AudioSessionType): void {
  const session = (navigator as Navigator & { audioSession?: { type: AudioSessionType } })
    .audioSession
  if (session) session.type = type
}
