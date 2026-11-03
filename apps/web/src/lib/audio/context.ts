let shared: AudioContext | null = null
let hides = 0
let sharedAtHide = 0
let watchingHides = false

export function audioContext(): AudioContext {
  watchHides()
  const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
  if (shared && !isClosed(shared)) {
    if (sharedAtHide === hides || hidden) return shared
    close(shared)
  }
  shared = new AudioContext()
  sharedAtHide = hidden ? -1 : hides
  return shared
}

const closing = new Set<(context: BaseAudioContext) => void>()

export function whenClosing(stop: (context: BaseAudioContext) => void): void {
  closing.add(stop)
}

const closed = new WeakSet<BaseAudioContext>()

export function isClosed(context: BaseAudioContext): boolean {
  return closed.has(context) || context.state === 'closed'
}

function close(context: AudioContext): void {
  closed.add(context)
  for (const stop of closing) stop(context)
  context.close().catch(() => {})
}

function watchHides(): void {
  if (watchingHides || typeof document === 'undefined') return
  watchingHides = true
  const hid = () => {
    hides += 1
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hid()
  })
  window.addEventListener('pagehide', hid)
}

export function replaceAudioContext(context: AudioContext): void {
  if (shared !== context) return
  shared = null
  close(context)
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
