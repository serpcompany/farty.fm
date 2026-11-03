import type { Page } from '@playwright/test'
import { test } from './test'

export const onABuild = process.env.E2E_SERVER === 'preview' || Boolean(process.env.E2E_BASE_URL)

export const errorsWhileOffline = [
  'net::ERR_INTERNET_DISCONNECTED',
  'Failed to fetch RSC payload',
  'An unknown error occurred when fetching the script'
]

export function needsTheServiceWorker(): void {
  test.skip(!onABuild, 'Only a build registers the service worker')
}

export async function controlledByTheServiceWorker(page: Page): Promise<void> {
  await page.waitForFunction(async () => {
    await navigator.serviceWorker.ready
    return navigator.serviceWorker.controller !== null
  })
}
