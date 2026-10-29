import type { Page } from '@playwright/test'

export function offerInstallPrompt(): void {
  const offered = window as unknown as { prompted: boolean; installTaken: boolean }
  offered.prompted = false
  offered.installTaken = false
  const offer = () => {
    if (offered.installTaken) return
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: async () => {
        offered.prompted = true
      }
    })
    window.dispatchEvent(event)
    offered.installTaken = event.defaultPrevented
  }
  const listen = EventTarget.prototype.addEventListener
  window.addEventListener = ((...args: Parameters<EventTarget['addEventListener']>) => {
    listen.apply(window, args)
    if (args[0] === 'beforeinstallprompt') queueMicrotask(offer)
  }) as typeof window.addEventListener
}

export function prompted(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as unknown as { prompted: boolean }).prompted)
}
