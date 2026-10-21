import { expect, type Page, type Request, test } from '@playwright/test'

// Error reports and usage (#126): what the browser sends to /api/telemetry/, that Profile's switch
// and Global Privacy Control stop all of it, and the Web Analytics beacon, Production's only.
//
// Most of it runs on Staging's build or `next dev`, which have the synthetic triggers on
// /dev/telemetry/ and no beacon. With E2E_SITE_ENV=production, against the Production build's
// preview (E2E_BASE_URL), only the beacon's tests run, and the triggers' page must be gone.

const production = process.env.E2E_SITE_ENV === 'production'
const SECRET = 'test@example.com'
const SWITCH = 'Share anonymous error reports and usage'
const BEACON = 'https://static.cloudflareinsights.com/beacon.min.js'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pedos.welcomed', '1'))
  // Never load Cloudflare's real beacon or send it a visit: a stand-in records that it loaded.
  await page.route('https://static.cloudflareinsights.com/**', route =>
    route.fulfill({ contentType: 'text/javascript', body: 'window.beaconLoaded = true' })
  )
  await page.route('**/cdn-cgi/rum**', route => route.fulfill({ status: 204 }))
})

/** Every request this page makes to the error report route, from now on. */
function reportsFrom(page: Page): Request[] {
  const sent: Request[] = []
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/telemetry/') sent.push(request)
  })
  return sent
}

/** Every request for Cloudflare's beacon, from now on. */
function beaconLoadsFrom(page: Page): Request[] {
  const loads: Request[] = []
  page.on('request', request => {
    if (request.url().startsWith('https://static.cloudflareinsights.com/')) loads.push(request)
  })
  return loads
}

/** Waits long enough for a report the page would send to have gone. */
async function aMoment(page: Page) {
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 300)))
}

async function turnSharingOff(page: Page) {
  await page.goto('/profile/')
  const share = page.getByRole('switch', { name: SWITCH })
  await expect(share).toBeChecked()
  await share.click()
  await expect(share).not.toBeChecked()
}

const withGpc = () =>
  Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true })

test.describe('error reports', () => {
  test.skip(production, "Production has no synthetic triggers: they're tested on Staging")

  test('a handled error and a crash each send one report: a code, never the message', async ({
    page
  }) => {
    const sent = reportsFrom(page)
    await page.goto('/dev/telemetry/')

    const handled = page.waitForResponse(response => response.url().endsWith('/api/telemetry/'))
    await page.getByRole('button', { name: 'Report a handled error' }).click()
    expect((await handled).status()).toBe(204)

    const crash = page.waitForRequest(
      request =>
        request.url().endsWith('/api/telemetry/') &&
        request.postDataJSON()?.code === 'uncaught-error'
    )
    await page.getByRole('button', { name: 'Crash' }).click()
    await crash

    const bodies = sent.map(request => request.postDataJSON())
    expect(bodies).toEqual([
      expect.objectContaining({ code: 'synthetic-handled', name: 'SyntheticError' }),
      expect.objectContaining({ code: 'uncaught-error', name: 'SyntheticCrash' })
    ])
    for (const [request, body] of sent.map(request => [request, request.postDataJSON()])) {
      expect(request.postData()).not.toContain(SECRET)
      expect(Object.keys(body).sort()).toEqual(
        ['code', 'delaySeconds', 'environment', 'name', 'release', 'screen'].sort()
      )
      expect(body).toMatchObject({ screen: 'dev', delaySeconds: 0 })
      expect(body.environment).toMatch(/^(local|staging)$/)
      expect(body.release).toMatch(/^\d+\.\d+\.\d+(\+[0-9a-f]{7})?$/)
    }
  })

  test('raised offline, a report waits on the device and goes once back online', async ({
    page,
    context
  }) => {
    const sent = reportsFrom(page)
    await page.goto('/dev/telemetry/')
    await context.setOffline(true)
    await page.getByRole('button', { name: 'Report a handled error' }).click()
    await aMoment(page)
    expect(sent).toEqual([])
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem('pedos.telemetry.queue') ?? '[]'))
    ).toHaveLength(1)

    const delivered = page.waitForResponse(response => response.url().endsWith('/api/telemetry/'))
    await context.setOffline(false)
    expect((await delivered).status()).toBe(204)
    expect(sent.map(request => request.postDataJSON())).toEqual([
      expect.objectContaining({ code: 'synthetic-handled', name: 'SyntheticError' })
    ])
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('pedos.telemetry.queue')))
      .toBeNull()
  })

  test("with Profile's switch off, nothing is sent, and it stays off", async ({ page }) => {
    const sent = reportsFrom(page)
    await turnSharingOff(page)
    const row = page.locator('label[for="share-telemetry"]')
    expect((await row.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)

    await page.goto('/dev/telemetry/')
    await page.getByRole('button', { name: 'Report a handled error' }).click()
    await page.getByRole('button', { name: 'Crash' }).click()
    await aMoment(page)
    expect(sent).toEqual([])

    await page.goto('/profile/')
    await expect(page.getByRole('switch', { name: SWITCH })).not.toBeChecked()
  })

  test('with Global Privacy Control, nothing is sent and the switch shows off', async ({
    page
  }) => {
    await page.addInitScript(withGpc)
    const sent = reportsFrom(page)
    await page.goto('/profile/')
    const share = page.getByRole('switch', { name: SWITCH })
    await expect(share).not.toBeChecked()
    await expect(share).toBeDisabled()
    await expect(page.getByText('Global Privacy Control')).toBeVisible()

    await page.goto('/dev/telemetry/')
    await page.getByRole('button', { name: 'Report a handled error' }).click()
    await page.getByRole('button', { name: 'Crash' }).click()
    await aMoment(page)
    expect(sent).toEqual([])
  })

  test('this build loads no Web Analytics beacon', async ({ page }) => {
    const loads = beaconLoadsFrom(page)
    for (const path of ['/', '/profile/', '/privacy/']) {
      await page.goto(path)
      await aMoment(page)
    }
    await expect(page.locator('script[src*="cloudflareinsights"]')).toHaveCount(0)
    expect(loads).toEqual([])
  })
})

test.describe('the Web Analytics beacon, in Production', () => {
  test.skip(!production, 'Only the Production build has a beacon')

  test("loads with pedos.app's token, and goes with the switch", async ({ page }) => {
    const loads = beaconLoadsFrom(page)
    await page.goto('/')
    const beacon = page.locator(`script[src="${BEACON}"]`)
    await expect(beacon).toHaveCount(1)
    await expect(beacon).toHaveAttribute(
      'data-cf-beacon',
      JSON.stringify({ token: 'e5c178acd813418c8a128caf531d2b03' })
    )
    await expect.poll(() => page.evaluate(() => 'beaconLoaded' in window)).toBe(true)
    expect(loads).toHaveLength(1)

    await turnSharingOff(page)
    await expect(beacon).toHaveCount(0)
    loads.length = 0
    await page.goto('/')
    await aMoment(page)
    await expect(beacon).toHaveCount(0)
    expect(loads).toEqual([])
  })

  test('never loads with Global Privacy Control', async ({ page }) => {
    await page.addInitScript(withGpc)
    const loads = beaconLoadsFrom(page)
    await page.goto('/')
    await aMoment(page)
    await expect(page.locator('script[src*="cloudflareinsights"]')).toHaveCount(0)
    expect(loads).toEqual([])
  })

  test('the synthetic triggers are not found', async ({ request }) => {
    const response = await request.get('/dev/telemetry/', { maxRedirects: 0 })
    expect(response.status()).toBe(404)
  })
})
