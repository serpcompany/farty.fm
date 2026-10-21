import { expect, type Page, test } from '@playwright/test'

// The product page at `/` from 768px, until Farty is opened in this browser (#191). Phones get
// Welcome instead, and download none of the lander's images.

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
