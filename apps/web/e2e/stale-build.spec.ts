import type { Page } from '@playwright/test'
import { fartAndRecord, waitForOpenMicrophone, withFartingMicrophone } from './fake-microphone'
import { skipWelcome } from './record'
import { onPhone, tab } from './screens'
import { controlledByTheServiceWorker, needsTheServiceWorker } from './service-worker'
import { expect, test } from './test'

test.skip(({ viewport }) => !onPhone({ viewport }), 'Phone only')

test.beforeEach(({ pageErrors }) => {
  pageErrors.expect('the server responded with a status of 404')
})

function countLoads(page: Page): () => number {
  let loads = 0
  page.on('load', () => {
    loads += 1
  })
  return () => loads
}

function navigationsAsAWorkerScriptFails(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>(resolve => {
        const navigations: string[] = []
        const navigation = (window as unknown as { navigation: EventTarget }).navigation
        navigation.addEventListener('navigate', event =>
          navigations.push((event as Event & { navigationType: string }).navigationType)
        )
        const worker = new Worker('/_next/static/chunks/gone-after-a-deploy.js')
        worker.addEventListener('error', () => resolve(navigations))
      })
  )
}

test.describe('a script that fails to load', () => {
  withFartingMicrophone()

  test('reloads the page once, after the unsaved Recording is gone', async ({ page }) => {
    const loads = countLoads(page)
    await page.goto('/')
    await waitForOpenMicrophone(page)
    await fartAndRecord(page)
    expect(loads()).toBe(1)

    expect(await navigationsAsAWorkerScriptFails(page)).toEqual([])
    expect(loads()).toBe(1)
    await expect(page.getByRole('heading', { name: 'New Recording' })).toBeVisible()

    const reloaded = page.waitForEvent('load')
    await page.getByRole('button', { name: 'Discard' }).click()
    await reloaded
    expect(loads()).toBe(2)
    await expect(page.getByTestId('record-button')).toBeVisible()

    expect(await navigationsAsAWorkerScriptFails(page)).toEqual([])
    expect(loads()).toBe(2)
    await expect(page.getByTestId('record-button')).toBeVisible()
  })
})

test('the service worker answers a 404 for a script it kept with its copy', async ({
  page,
  context
}) => {
  needsTheServiceWorker()
  await page.addInitScript(skipWelcome)
  await page.goto('/')
  await controlledByTheServiceWorker(page)
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

  await context.route('**/_next/static/**', route =>
    route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not Found' })
  )
  const answer = await page.evaluate(async url => {
    const response = await fetch(url)
    return { status: response.status, text: await response.text() }
  }, kept.url)
  expect(answer.status).toBe(200)
  expect(answer.text).toBe(kept.text)

  const uncached = await page.evaluate(() =>
    fetch('/_next/static/chunks/never-kept.js').then(response => response.status)
  )
  expect(uncached).toBe(404)

  await page.reload()
  await expect(page.getByTestId('record-button')).toBeVisible()
  await tab(page, 'Recordings').click()
  await expect(page.getByText('No Recordings yet')).toBeVisible()
})
