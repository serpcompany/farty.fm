import { persistAsked, standInForPersist } from './database'
import { offerInstallPrompt, prompted } from './install-prompt'
import { recordG3, withFartingMicrophone } from './record'
import {
  controlledByTheServiceWorker,
  errorsWhileOffline,
  needsTheServiceWorker
} from './service-worker'
import { expect, test } from './test'

withFartingMicrophone()

const iPhoneSafari =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1'

function pngSize(png: Buffer): string {
  return `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`
}

test('the manifest names Farty, opens it full screen, and has its icons', async ({ page }) => {
  await page.goto('/')
  const link = page.locator('link[rel="manifest"]')
  await expect(link).toHaveAttribute('crossorigin', 'use-credentials')

  const response = await page.request.get((await link.getAttribute('href')) ?? '')
  expect(response.headers()['content-type']).toContain('application/manifest+json')
  const manifest = await response.json()
  expect(manifest).toMatchObject({ name: 'Farty', start_url: '/', display: 'standalone' })

  const icons: { src: string; sizes: string; purpose: string }[] = manifest.icons
  for (const purpose of ['any', 'maskable']) {
    expect(icons.filter(icon => icon.purpose === purpose).map(icon => icon.sizes)).toEqual(
      expect.arrayContaining(['192x192', '512x512'])
    )
  }
  for (const icon of icons) {
    const file = await page.request.get(icon.src)
    expect(file.status(), icon.src).toBe(200)
    expect(file.headers()['content-type'], icon.src).toBe('image/png')
    expect(pngSize(await file.body()), icon.src).toBe(icon.sizes)
  }

  const chromium = await page.context().newCDPSession(page)
  expect(await chromium.send('Page.getInstallabilityErrors')).toEqual({ installabilityErrors: [] })
})

test('the service worker opens the app shell offline', async ({ page, context, pageErrors }) => {
  needsTheServiceWorker()
  pageErrors.expect(...errorsWhileOffline, 'net::ERR_FAILED')
  await page.goto('/')
  await controlledByTheServiceWorker(page)

  await context.setOffline(true)
  const uncached = await page.evaluate(() =>
    fetch('/icons/maskable-512.png?never-fetched').then(
      () => 'loaded',
      () => 'failed'
    )
  )
  expect(uncached).toBe('failed')

  await page.reload()
  await expect(page.getByTestId('record-button')).toBeVisible()
  await page.goto('/recordings/')
  await expect(page.getByText('No Recordings yet')).toBeVisible()
  await page.getByRole('link', { name: 'Record', exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByTestId('record-button')).toBeVisible()

  await context.setOffline(false)
})

test.describe('on iPhone', () => {
  test.use({ userAgent: iPhoneSafari })

  test('after the first saved Recording, says how to add Farty to the Home Screen, once', async ({
    page
  }) => {
    await page.addInitScript(standInForPersist)
    const card = page.getByRole('complementary', { name: 'Install Farty' })

    await recordG3(page)
    await expect(card).toBeHidden()
    await expect.poll(() => persistAsked(page)).toBe(true)

    await page.getByRole('button', { name: 'Done' }).click()
    await expect(page).toHaveURL(/\/recordings\/$/)
    await expect(card).toHaveText(/^Install Farty\s*Tap\s+Share, then Add to Home Screen$/)

    await card.getByRole('button', { name: 'Close' }).click()
    await expect(card).toBeHidden()
    await page.reload()
    await expect(page.getByTestId('recording-row')).toHaveCount(1)
    await expect(card).toBeHidden()
  })
})

test.describe('on Android', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(offerInstallPrompt)
  })

  test('after the first saved Recording, offers Chrome’s install prompt', async ({ page }) => {
    const card = page.getByRole('complementary', { name: 'Install Farty' })
    await recordG3(page)
    await page.getByRole('button', { name: 'Done' }).click()
    await card.getByRole('button', { name: 'Install app' }).click()
    expect(await prompted(page)).toBe(true)
    await expect(card).toBeHidden()
  })

  test('hides the offer once Farty is installed', async ({ page }) => {
    const card = page.getByRole('complementary', { name: 'Install Farty' })
    await recordG3(page)
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(card.getByRole('button', { name: 'Install app' })).toBeVisible()
    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')))
    await expect(card).toBeHidden()
  })
})
