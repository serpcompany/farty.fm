import { microphoneGrantMemory } from './audio/recorder'
import { currentSafariAllowRoute, type SafariAllowRoute } from './install'

const toldKey = 'pedos.safariAllowTold'

/**
 * Where to tell this person, now, to set Safari's Microphone to Allow (#374), or null not to: on
 * an iPhone whose grant the browser forgets, once. It counts as told when it shows, since leaving
 * for Settings comes back on Record, and once the grant is remembered, so it never shows after
 * that.
 */
export function safariAllowRouteToTell(): SafariAllowRoute | null {
  const route = currentSafariAllowRoute()
  if (route === null) return null
  const memory = microphoneGrantMemory()
  if (memory === 'unknown') return null
  try {
    if (localStorage.getItem(toldKey) !== null) return null
    localStorage.setItem(toldKey, '1')
  } catch {
    return null // Storage is blocked, so Farty couldn't remember. It doesn't tell at all.
  }
  return memory === 'forgotten' ? route : null
}
