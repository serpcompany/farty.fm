import { expect, type Page, test } from '@playwright/test'
import { skipWelcome, withFakeMicrophone } from './record'

// The product page at `/` from 768px, until Farty is opened in this browser (#191). Phones get
// Welcome instead, and download none of the lander's images.

// Only the record flow's test records.
withFakeMicrophone('090__carlosramon__17-pet__186119.wav')

function hero(page: Page) {
  return page.getByRole('heading', { name: 'Record your farts. Turn them into songs.', level: 1 })
}

function tabs(page: Page) {
  return page.getByRole('navigation', { name: 'Tabs' })
}

test.describe('from 768px', () => {
  test.skip(({ isMobile }) => isMobile, 'The lander is checked at desktop size')

  test('a first visit shows the lander; Open Farty shows the app, and a reload goes straight to it', async ({
    page
  }) => {
    await page.goto('/')
    await expect(hero(page)).toBeVisible()
    await expect(tabs(page)).toBeHidden()

    // The hero's, between the header's and the closing band's.
    await page.getByRole('button', { name: 'Open Farty' }).nth(1).click()
    await expect(hero(page)).toBeHidden()
    await expect(tabs(page)).toBeVisible()
    await expect(page.getByTestId('record-button')).toBeVisible()

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

    await page.getByTestId('record-button').click()
    await expect(page.getByTestId('recording-timer')).toBeVisible()
    await underTopBar('Recording')
    await page.waitForTimeout(1000)
    await page.getByTestId('stop-button').click()
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
  isMobile
}) => {
  test.skip(!isMobile, 'Phone only')
  const images: string[] = []
  page.on('request', request => {
    if (request.url().includes('/lander/')) images.push(request.url())
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Allow microphone' })).toBeVisible()
  await expect(hero(page)).toBeHidden()
  await page.waitForLoadState('networkidle')
  expect(images).toEqual([])
})
