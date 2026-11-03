export type InstallRoute = 'prompt' | 'share-sheet'

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
  if (/iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touch)) {
    return /Safari\//.test(userAgent) && !inAppBrowser.test(userAgent)
      ? 'share-sheet'
      : 'open-in-safari'
  }
  if (/Android/.test(userAgent) || (/Linux/.test(userAgent) && touch)) {
    if (/; wv\)/.test(userAgent) || inAppBrowser.test(userAgent)) return 'open-in-browser'
    return /SamsungBrowser\//.test(userAgent) ? 'samsung-menu' : 'browser-menu'
  }
  return 'phone'
}

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

export function currentInstallGuide(): InstallGuide | null {
  if (typeof window === 'undefined') return null
  return installGuideFor({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone:
      installed ||
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
    canPrompt: deferredPrompt !== null
  })
}

export function currentInstallRoute(): InstallRoute | null {
  return routeOf(currentInstallGuide())
}

export function subscribeToInstall(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function promptInstall(): Promise<void> {
  const event = deferredPrompt
  if (!event) return
  deferredPrompt = null
  changed()
  await event.prompt()
}

export async function keepRecordings(): Promise<boolean> {
  const storage = navigator.storage
  if (!storage?.persist) return false
  try {
    return (await storage.persisted()) || (await storage.persist())
  } catch {
    return false
  }
}

export function registerServiceWorker(): void {
  if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return
  navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {})
}
