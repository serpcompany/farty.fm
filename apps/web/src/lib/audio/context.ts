let shared: AudioContext | null = null

export function audioContext(): AudioContext {
  if (!shared || shared.state === 'closed') shared = new AudioContext()
  return shared
}

export function replaceAudioContext(context: AudioContext): void {
  if (shared !== context) return
  shared = null
  context.close().catch(() => {})
}

export function startAudioInTap(): void {
  setPlaybackSession()
  audioContext()
    .resume()
    .catch(() => {})
}

type AudioSessionType = 'auto' | 'playback' | 'play-and-record'

let microphoneOpen = false

export function setMicrophoneSession(open: boolean): void {
  microphoneOpen = open
  setAudioSession(open ? 'play-and-record' : 'playback')
}

export function setPlaybackSession(): void {
  if (!microphoneOpen) setAudioSession('playback')
}

function setAudioSession(type: AudioSessionType): void {
  const session = (navigator as Navigator & { audioSession?: { type: AudioSessionType } })
    .audioSession
  if (session) session.type = type
}
