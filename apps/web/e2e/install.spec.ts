import { expect, test } from '@playwright/test'
import { recordAndSave, withFakeMicrophone } from './record'

// Fixture 090 is Melodic (G3). The install offer waits for the first saved Recording.
withFakeMicrophone('090__carlosramon__17-pet__186119.wav')

const iPhoneSafari =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1'

/** A PNG's width and height, from its IHDR chunk. */
function pngSize(png: Buffer): string {
  return `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`
}

test('the manifest names Farty, opens it full screen, and has its icons', async ({ page }) => {
  await page.goto('/')
  const link = page.locator('link[rel="manifest"]')
  // Without credentials, Chrome can't fetch it behind the Staging password.
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

  // Chromium's own check, the one behind Android's Install app. Full Chromium, which macOS runs
  // use (playwright.config.ts), also counts Playwright's off-the-record context against it; CI's
  // headless shell doesn't, so CI stays strict.
  const chromium = await page.context().newCDPSession(page)
  const { installabilityErrors } = await chromium.send('Page.getInstallabilityErrors')
  const onMac = process.platform === 'darwin'
  expect(installabilityErrors.filter(error => !onMac || error.errorId !== 'in-incognito')).toEqual(
    []
  )
})

test('the service worker opens the app shell offline', async ({ page, context }) => {
  test.skip(
    process.env.E2E_SERVER !== 'preview' && !process.env.E2E_BASE_URL,
    'Only a build registers the service worker'
  )
  await page.addInitScript(() => localStorage.setItem('pedos.welcomed', '1'))
  await page.goto('/')
  await page.waitForFunction(async () => {
    await navigator.serviceWorker.ready
    return navigator.serviceWorker.controller !== null
  })

  await context.setOffline(true)
  // A file the shell never loaded fails offline, so what loads below came from the cache.
  const uncached = await page.evaluate(() =>
    fetch('/icons/maskable-512.png?never-fetched').then(
      () => 'loaded',
      () => 'failed'
    )
  )
  expect(uncached).toBe('failed')

  await page.reload()
  await expect(page.getByTestId('record-button')).toBeVisible()
  // The other tab, never opened before, loads from the cache too.
  await page.goto('/recordings/')
  // Only the app's scripts show this, after they've read the (empty) Recordings.
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
    await page.addInitScript(() => {
      const asked = window as unknown as { keepAsked: boolean }
      asked.keepAsked = false
      navigator.storage.persisted = async () => false
      navigator.storage.persist = async () => {
        asked.keepAsked = true
        return true
      }
    })
    const card = page.getByRole('complementary', { name: 'Install Farty' })

    await recordAndSave(page, 1.5)
    await expect(page.getByTestId('result-note')).toHaveText('G3')
    // Never over the new Recording's note.
    await expect(card).toBeHidden()
    // A guest's Recordings are kept (#203), so with the first one Farty asks the browser to keep
    // them.
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { keepAsked: boolean }).keepAsked))
      .toBe(true)

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
    // Chrome fires beforeinstallprompt only for an installable site it trusts; this stands in.
    await page.addInitScript(() => {
      const prompted = window as unknown as { prompted: boolean }
      prompted.prompted = false
      // Offered until Farty's listener takes it, as Chrome offers it once the page is ready.
      const offer = () => {
        const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
          prompt: async () => {
            prompted.prompted = true
          }
        })
        window.dispatchEvent(event)
        if (!event.defaultPrevented) setTimeout(offer, 100)
      }
      window.addEventListener('load', offer)
    })
  })

  test('after the first saved Recording, offers Chrome’s install prompt', async ({ page }) => {
    const card = page.getByRole('complementary', { name: 'Install Farty' })

    await recordAndSave(page, 1.5)
    await page.getByRole('button', { name: 'Done' }).click()
    await card.getByRole('button', { name: 'Install app' }).click()
    expect(await page.evaluate(() => (window as unknown as { prompted: boolean }).prompted)).toBe(
      true
    )
    await expect(card).toBeHidden()
  })

  test('hides the offer once Farty is installed', async ({ page }) => {
    const card = page.getByRole('complementary', { name: 'Install Farty' })

    await recordAndSave(page, 1.5)
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(card.getByRole('button', { name: 'Install app' })).toBeVisible()
    // Chrome fires this when Farty is installed, from its prompt or its own menu.
    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')))
    await expect(card).toBeHidden()
  })
})
