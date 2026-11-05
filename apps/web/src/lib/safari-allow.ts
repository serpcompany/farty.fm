import { microphoneGrantMemory } from './audio/recorder'
import { currentlyUsesSafariMicrophoneSetting } from './install'

const toldKey = 'pedos.safariAllowTold'

/**
 * Whether to tell this person, now, how to set Safari's Microphone to Allow (#374): on an iPhone
 * whose grant the browser forgets, once. It counts as told when it shows, since coming back from
 * Settings lands on Record, and once the grant is remembered, so it never shows after that.
 */
export function shouldTellOfSafariAllow(): boolean {
  if (!currentlyUsesSafariMicrophoneSetting()) return false
  const memory = microphoneGrantMemory()
  if (memory === 'unknown') return false
  try {
    if (localStorage.getItem(toldKey) !== null) return false
    localStorage.setItem(toldKey, '1')
  } catch {
    return false // Storage is blocked, so Farty couldn't remember. It doesn't tell at all.
  }
  return memory === 'forgotten'
}
