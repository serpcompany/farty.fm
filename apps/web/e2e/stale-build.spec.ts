import { expect, type Page, test } from '@playwright/test'
import {
  fakeMicrophone,
  fartAndRecord,
  fixtureWavs,
  getUserMediaMs,
  waitForOpenMicrophone
} from './fake-microphone'
import { skipWelcome } from './record'
import { onPhone } from './screens'

// A tab opened before a deploy keeps running the older build, whose scripts the deploy took off
// the server (#222). The service worker answers with the copy it kept; a script that still fails
// to load reloads the page once, and never while a Recording is unsaved.

test.skip(({ viewport }) => !onPhone({ viewport }), 'Phone only')

/** Counts the page's loads, the first included. */
function countLoads(page: Page): () => number {
  let loads = 0
  page.on('load', () => {
    loads += 1
  })
  return () => loads
}

/** Starts a worker whose script is gone from the server, as an older build's render worker is. */
function startGoneWorker(page: Page): Promise<void> {
  return page.evaluate(() => {
    new Worker('/_next/static/chunks/gone-after-a-deploy.js')
  })
}

test.describe('a script that fails to load', () => {
  test.use({ permissions: ['microphone'] })

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(fakeMicrophone, { wavs: fixtureWavs(), delayMs: getUserMediaMs })
    await page.addInitScript(skipWelcome)
  })

  test('reloads the page once, after the unsaved Recording is gone', async ({ page }) => {
    const loads = countLoads(page)
    await page.goto('/')
    await waitForOpenMicrophone(page)
    await fartAndRecord(page)
    expect(loads()).toBe(1)

    // On Review, the Recording is unsaved: the page waits.
    await startGoneWorker(page)
    await page.waitForTimeout(1500)
    expect(loads()).toBe(1)
    await expect(page.getByRole('heading', { name: 'New Recording' })).toBeVisible()

    // Discarded, the page reloads onto the new build.
    const reloaded = page.waitForEvent('load')
    await page.getByRole('button', { name: 'Discard' }).click()
    await reloaded
    expect(loads()).toBe(2)
    await expect(page.getByTestId('record-button')).toBeVisible()

    // The same failure again, so soon after: no second reload.
    await startGoneWorker(page)
    await page.waitForTimeout(1500)
    expect(loads()).toBe(2)
    await expect(page.getByTestId('record-button')).toBeVisible()
  })
})

test('the service worker answers a 404 for a script it kept with its copy', async ({
  page,
  context
}) => {
  test.skip(
    process.env.E2E_SERVER !== 'preview' && !process.env.E2E_BASE_URL,
    'Only a build registers the service worker'
  )
  await page.addInitScript(skipWelcome)
  await page.goto('/')
  await page.waitForFunction(async () => {
    await navigator.serviceWorker.ready
    return navigator.serviceWorker.controller !== null
  })
  const kept = await page.evaluate(async () => {
    const cache = await caches.open('pedos-shell-v1')
    for (const request of await cache.keys()) {
      const { pathname } = new URL(request.url)
      if (pathname.startsWith('/_next/static/chunks/') && pathname.endsWith('.js')) {
        const response = await cache.match(request)
        return { url: request.url, text: (await response?.text()) ?? '' }
      }
    }
    return null
  })
  expect(kept).not.toBeNull()
  if (!kept) return

  // A deploy took every script of this build off the server.
  await context.route('**/_next/static/**', route =>
    route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not Found' })
  )
  const answer = await page.evaluate(async url => {
    const response = await fetch(url)
    return { status: response.status, text: await response.text() }
  }, kept.url)
  expect(answer.status).toBe(200)
  expect(answer.text).toBe(kept.text)

  // A script it never kept stays a 404.
  const uncached = await page.evaluate(() =>
    fetch('/_next/static/chunks/never-kept.js').then(response => response.status)
  )
  expect(uncached).toBe(404)

  // The whole tab loads from the kept copies.
  await page.reload()
  await expect(page.getByTestId('record-button')).toBeVisible()
  await page.getByRole('link', { name: 'Recordings', exact: true }).click()
  await expect(page.getByText('No Recordings yet')).toBeVisible()
})
