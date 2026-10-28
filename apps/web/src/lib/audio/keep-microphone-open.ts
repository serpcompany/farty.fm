import { desktop } from '@/lib/desktop'
import { audioContext } from './context'
import {
  cancelHiddenRelease,
  currentMicrophone,
  ended,
  getMicrophoneStream,
  loadCaptureProcessor,
  loseTake,
  microphoneOpening,
  openMicrophone,
  releaseIfHiddenAndListening,
  releaseMicrophone,
  resumeCapture,
  silent
} from './microphone'
import {
  captureStopped,
  captureStoppedJustNow,
  mayOpenWithoutTap,
  microphoneGranted
} from './microphone-grant'

let keeping = false
let computer: MediaQueryList | null = null
let shownTimer: ReturnType<typeof setTimeout> | undefined

const unmuteWaitMs = 1500

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

function becameComputer(event: MediaQueryListEvent): void {
  if (!event.matches) return
  keeping = false
  cancelHiddenRelease()
  clearTimeout(shownTimer)
  computer?.removeEventListener('change', becameComputer)
  document.removeEventListener('visibilitychange', visibilityChanged)
  window.removeEventListener('pagehide', releaseMicrophone)
  releaseMicrophone()
}

function visibilityChanged(): void {
  cancelHiddenRelease()
  clearTimeout(shownTimer)
  if (document.visibilityState === 'hidden') pageHidden()
  else pageShown()
}

function pageHidden(): void {
  if (microphoneOpening()) releaseMicrophone()
  loseTake()
  captureStopped()
  releaseIfHiddenAndListening()
}

function pageShown(): void {
  const mic = currentMicrophone()
  if (!mic || ended(mic)) {
    if (mic) releaseMicrophone()
    void openIfAllowed()
    return
  }
  if (!silent(mic)) {
    resumeCapture(mic)
    return
  }
  shownTimer = setTimeout(() => {
    if (currentMicrophone() !== mic || !silent(mic) || document.visibilityState !== 'visible') {
      return
    }
    releaseMicrophone()
    void openIfAllowed()
  }, unmuteWaitMs)
}

async function openIfAllowed(): Promise<void> {
  if (!(await mayOpenWithoutTap())) {
    loadCaptureProcessor(audioContext()).catch(() => {})
    return
  }
  if (keeping && document.visibilityState === 'visible') openMicrophone().catch(() => {})
}

export async function askForMicrophone(): Promise<void> {
  if (keeping) {
    await openMicrophone()
    return
  }
  const stream = await getMicrophoneStream()
  for (const track of stream.getTracks()) track.stop()
  microphoneGranted()
  captureStoppedJustNow()
}
