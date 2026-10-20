/**
 * Installing Pedos from the browser. Chrome on Android has its own install prompt
 * (`beforeinstallprompt`), which Pedos holds until it offers an Install app button. Safari on
 * iPhone has none, so Pedos says how to use Share, then Add to Home Screen.
 */

/** How this browser installs Pedos: Chrome's prompt, or the Share sheet on iPhone and iPad. */
export type InstallRoute = 'prompt' | 'share-sheet'

type BeforeInstallPromptEvent = Event & { prompt(): Promise<void> }

// In-app browsers that name their app in the user agent. Some of them, such as the Google app's,
// also send "Safari/", but none can add to the Home Screen. In-app browsers built on
// SFSafariViewController send Safari's exact user agent, so they can't be told apart.
const inAppBrowser =
  /GSA\/|FBAN|FBAV|Instagram|Line\/|Twitter|LinkedInApp|Snapchat|musical_ly|BytedanceWebview/

export function installRouteFor(browser: {
  userAgent: string
  maxTouchPoints: number
  standalone: boolean
  canPrompt: boolean
}): InstallRoute | null {
  if (browser.standalone) return null
  if (browser.canPrompt) return 'prompt'
  const { userAgent } = browser
  // iPadOS Safari reports itself as a Mac, and only touch gives it away.
  const apple =
    /iPhone|iPad|iPod/.test(userAgent) ||
    (/Macintosh/.test(userAgent) && browser.maxTouchPoints > 1)
  // Safari, and Chrome and Firefox on iOS, send "Safari/". Most in-app browsers leave it out.
  return apple && /Safari\//.test(userAgent) && !inAppBrowser.test(userAgent) ? 'share-sheet' : null
}

let deferredPrompt: BeforeInstallPromptEvent | null = null
let installed = false
const listeners = new Set<() => void>()

function changed(): void {
  for (const listener of listeners) listener()
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', event => {
    // Chrome would show its own banner now. Pedos offers to install after the first saved
    // Recording instead.
    event.preventDefault()
    deferredPrompt = event as BeforeInstallPromptEvent
    changed()
  })
  window.addEventListener('appinstalled', () => {
    installed = true
    deferredPrompt = null
    changed()
  })
}

/** How this browser can install Pedos now, or null when it's installed or can't be. */
export function currentInstallRoute(): InstallRoute | null {
  if (typeof window === 'undefined' || installed) return null
  return installRouteFor({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone:
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
    canPrompt: deferredPrompt !== null
  })
}

/** Calls `listener` when `currentInstallRoute()` may have changed. Returns a function that stops it. */
export function subscribeToInstall(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Shows Chrome's install prompt. Call it from a tap. */
export async function promptInstall(): Promise<void> {
  const event = deferredPrompt
  if (!event) return
  // Each prompt shows once. If it's dismissed, Chrome fires a new event when it can offer again.
  deferredPrompt = null
  changed()
  await event.prompt()
}

/** Asks the browser to keep Pedos's storage, the Recordings, when the device runs low on space. */
export async function keepRecordings(): Promise<boolean> {
  const storage = navigator.storage
  if (!storage?.persist) return false
  try {
    return (await storage.persisted()) || (await storage.persist())
  } catch {
    return false
  }
}

/** Registers `public/sw.js`, which lets Pedos open offline. */
export function registerServiceWorker(): void {
  // Only a build registers it. On `next dev` it would outlive the session on a localhost port
  // that other apps use too, and answer for them whenever their dev server is down.
  if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return
  // updateViaCache 'none': every update check fetches sw.js from the network.
  navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {
    // Pedos still works online without it. It just can't open offline.
  })
}
