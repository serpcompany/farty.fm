import type { Page } from '@playwright/test'
import {
  skipWelcome,
  startRecordingAFart,
  stopPastTheFart,
  waitForOpenMicrophone,
  withFartingMicrophone
} from './record'
import { hero, onPhone } from './screens'
import { onABuild } from './service-worker'
import { expect, test } from './test'

withFartingMicrophone({ welcomed: false })

function tabs(page: Page) {
  return page.getByRole('navigation', { name: 'Tabs' })
}

function app(page: Page) {
  return page.getByRole('main')
}

test.describe('on a touch tablet', () => {
  test.skip(({ viewport }) => onPhone({ viewport }), 'The lander is checked on a touch tablet')

  test('a first visit shows the lander; Open Farty shows the app, and a reload goes straight to it', async ({
    page
  }) => {
    await page.goto('/')
    await expect(hero(page)).toBeVisible()
    await expect(tabs(page)).toBeHidden()
    await expect(page.getByRole('button', { name: 'Download App' })).toHaveCount(0)

    const openFartyInTheHero = page.getByRole('button', { name: 'Open Farty' }).nth(1)
    await openFartyInTheHero.click()
    await expect(hero(page)).toBeHidden()
    await expect(tabs(page)).toBeVisible()
    await expect(page.getByTestId('record-button')).toBeVisible()
    await expect(app(page)).toBeFocused()

    await page.reload()
    await expect(page.getByTestId('record-button')).toBeVisible()
    await expect(hero(page)).toBeHidden()
  })

  test('Sign up free opens the account step under the top bar, whose tabs wait for it', async ({
    page
  }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Sign up free' }).click()

    const step = page.getByRole('dialog', { name: 'Keep your farts' })
    await expect(step).toBeVisible()
    await expect(hero(page)).toBeHidden()
    await expect(tabs(page)).toBeVisible()
    await expect(tabs(page)).toHaveAttribute('inert', '')
    const top = await tabs(page).boundingBox()
    const card = await step.locator('div').first().boundingBox()
    expect(card?.y).toBeGreaterThan((top?.y ?? 0) + (top?.height ?? 0))

    await step.getByRole('button', { name: 'Not now' }).click()
    await expect(step).toBeHidden()
    await expect(tabs(page)).not.toHaveAttribute('inert')
    await expect(page.getByTestId('record-button')).toBeVisible()
    await expect(app(page)).toBeFocused()
  })

  test('Sign up free opens the account step where storage is blocked', async ({ page }) => {
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException('Blocked', 'SecurityError')
      }
    })
    await page.goto('/')
    await page.getByRole('button', { name: 'Sign up free' }).click()
    await expect(page.getByRole('dialog', { name: 'Keep your farts' })).toBeVisible()
    await expect(hero(page)).toBeHidden()
  })

  test("another tab's URL opens the app and counts as opened", async ({ page }) => {
    await page.goto('/compose/')
    await expect(page.getByRole('heading', { name: 'Compose', level: 1 })).toBeVisible()
    await expect(hero(page)).toHaveCount(0)

    await tabs(page).getByRole('link', { name: 'Record', exact: true }).click()
    await expect(page.getByTestId('record-button')).toBeVisible()
    await expect(hero(page)).toBeHidden()
  })

  test('Recording, Review and Result are a card under the top bar, whose tabs wait for them', async ({
    page
  }) => {
    test.setTimeout(60_000)
    await page.addInitScript(skipWelcome, {})
    await page.goto('/')
    const top = await tabs(page).boundingBox()
    const underTopBar = async (name: string) => {
      const card = page.getByRole('dialog', { name })
      await expect(card).toBeVisible()
      await expect(tabs(page)).toBeVisible()
      await expect(tabs(page)).toHaveAttribute('inert', '')
      expect((await card.boundingBox())?.y).toBeGreaterThan((top?.y ?? 0) + (top?.height ?? 0))
    }

    await waitForOpenMicrophone(page)
    await startRecordingAFart(page)
    await expect(page.getByTestId('recording-timer')).toBeVisible()
    await underTopBar('Recording')
    await stopPastTheFart(page)
    await underTopBar('New Recording')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('result-note').or(page.getByTestId('result-noise'))).toBeVisible({
      timeout: 30_000
    })
    await underTopBar('Recording 1')

    await page.getByRole('button', { name: 'Done' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(tabs(page)).not.toHaveAttribute('inert')
  })
})

test('a phone gets Welcome, not the lander, and downloads none of its images', async ({
  page,
  context,
  viewport
}) => {
  test.skip(!onPhone({ viewport }), 'Phone only')
  const images: string[] = []
  context.on('request', request => {
    if (request.url().includes('/lander/')) images.push(request.url())
  })
  await page.goto('/compose/')
  await expect(page.getByRole('button', { name: 'Allow microphone' })).toBeVisible()
  await expect(hero(page)).toBeHidden()
  await page.waitForLoadState('networkidle')
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Allow microphone' })).toBeVisible()
  await expect(hero(page)).toBeHidden()
  await page.waitForLoadState('networkidle')
  if (onABuild) {
    const kept = await page.evaluate(async () => {
      await navigator.serviceWorker.ready
      const urls: string[] = []
      for (const name of await caches.keys()) {
        for (const request of await (await caches.open(name)).keys()) urls.push(request.url)
      }
      return urls
    })
    expect(kept).toContain(new URL('/', page.url()).href)
    expect(kept.filter(url => url.includes('/lander/'))).toEqual([])
  }
  expect(images).toEqual([])
})
