/**
 * Installing Farty from the browser. Chrome on Android has its own install prompt
 * (`beforeinstallprompt`), which Farty holds until it offers an Install app button. Safari on
 * iPhone has none, so Farty says how to use Share, then Add to Home Screen. Profile says how for
 * every browser (`installGuideFor`).
 */

/** How this browser installs Farty: Chrome's prompt, or the Share sheet on iPhone and iPad. */
export type InstallRoute = 'prompt' | 'share-sheet'

/**
 * What Profile says about installing Farty here:
 * - `installed`: it runs from the Home Screen, or Chrome just installed it.
 * - `prompt`: Chrome's install prompt, behind an Install app button.
 * - `share-sheet`: Safari on iPhone and iPad, and the browsers built on it: Share, then Add to
 *   Home Screen.
 * - `browser-menu`: Android before or without Chrome's prompt: the browser's menu, then Install.
 * - `samsung-menu`: Samsung Internet, whose menu says Add page to, then Home screen.
 * - `open-in-safari`, `open-in-browser`: an in-app browser, on iPhone or Android, which can't
 *   install Farty, so first open the page in Safari or the browser.
 * - `phone`: a computer, where Farty is a phone app (#199).
 */
export type InstallGuide =
  | 'installed'
  | 'prompt'
  | 'share-sheet'
  | 'browser-menu'
  | 'samsung-menu'
  | 'open-in-safari'
  | 'open-in-browser'
  | 'phone'

type BeforeInstallPromptEvent = Event & { prompt(): Promise<void> }

// In-app browsers that name their app in the user agent. Some of them, such as the Google app's,
// also send "Safari/", but none can add to the Home Screen. In-app browsers built on
// SFSafariViewController send Safari's exact user agent, so they can't be told apart.
const inAppBrowser =
  /GSA\/|FBAN|FBAV|Instagram|Line\/|Twitter|LinkedInApp|Snapchat|musical_ly|BytedanceWebview/

type Browser = {
  userAgent: string
  maxTouchPoints: number
  standalone: boolean
  canPrompt: boolean
}

export function installGuideFor(browser: Browser): InstallGuide {
  if (browser.standalone) return 'installed'
  if (browser.canPrompt) return 'prompt'
  const { userAgent } = browser
  const touch = browser.maxTouchPoints > 1
  // iPadOS Safari reports itself as a Mac, and only touch gives it away.
  if (/iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touch)) {
    // Safari, and Chrome and Firefox on iOS, send "Safari/". Most in-app browsers leave it out.
    return /Safari\//.test(userAgent) && !inAppBrowser.test(userAgent)
      ? 'share-sheet'
      : 'open-in-safari'
  }
  // Chrome on an Android tablet asks for desktop sites, as Linux, and only touch gives it away.
  if (/Android/.test(userAgent) || (/Linux/.test(userAgent) && touch)) {
    // "wv" is Android's WebView, which in-app browsers are built on.
    if (/; wv\)/.test(userAgent) || inAppBrowser.test(userAgent)) return 'open-in-browser'
    return /SamsungBrowser\//.test(userAgent) ? 'samsung-menu' : 'browser-menu'
  }
  return 'phone'
}

/** How this browser can install Farty now, or null when it's installed or can't be. */
export function installRouteFor(browser: Browser): InstallRoute | null {
  return routeOf(installGuideFor(browser))
}

function routeOf(guide: InstallGuide | null): InstallRoute | null {
  return guide === 'prompt' || guide === 'share-sheet' ? guide : null
}

let deferredPrompt: BeforeInstallPromptEvent | null = null
let installed = false
const listeners = new Set<() => void>()

function changed(): void {
  for (const listener of listeners) listener()
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', event => {
    // Chrome would show its own banner now. Farty offers to install after the first saved
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

/** What Profile says about installing Farty here, or null on the server. */
export function currentInstallGuide(): InstallGuide | null {
  if (typeof window === 'undefined') return null
  return installGuideFor({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    // Chrome's appinstalled counts too: Farty is on the Home Screen, though this tab isn't it.
    standalone:
      installed ||
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
    canPrompt: deferredPrompt !== null
  })
}

/** How this browser can install Farty now, or null when it's installed or can't be. */
export function currentInstallRoute(): InstallRoute | null {
  return routeOf(currentInstallGuide())
}

/** Calls `listener` when `currentInstallGuide()` may have changed. Returns a function that stops it. */
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

/** Asks the browser to keep Farty's storage, the Recordings, when the device runs low on space. */
export async function keepRecordings(): Promise<boolean> {
  const storage = navigator.storage
  if (!storage?.persist) return false
  try {
    return (await storage.persisted()) || (await storage.persist())
  } catch {
    return false
  }
}

/** Registers `public/sw.js`, which lets Farty open offline. */
export function registerServiceWorker(): void {
  // Only a build registers it. On `next dev` it would outlive the session on a localhost port
  // that other apps use too, and answer for them whenever their dev server is down.
  if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return
  // updateViaCache 'none': every update check fetches sw.js from the network.
  navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {
    // Farty still works online without it. It just can't open offline.
  })
}
