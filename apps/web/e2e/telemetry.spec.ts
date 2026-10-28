import type { Page, Request } from '@playwright/test'
import { errorsWhileOffline } from './service-worker'
import { expect, test } from './test'

const production = process.env.E2E_SITE_ENV === 'production'
const SECRET = 'test@example.com'
const SWITCH = 'Share anonymous error reports'

test.beforeEach(async ({ page, pageErrors }) => {
  pageErrors.expect('A synthetic crash')
  await page.addInitScript(() => localStorage.setItem('pedos.welcomed', '1'))
  await page.addInitScript(countReportsStarted)
})

function countReportsStarted(): void {
  const counted = window as unknown as { fartyReportsStarted: number }
  counted.fartyReportsStarted = 0
  const fetch = window.fetch
  window.fetch = (input, init) => {
    if (String(input instanceof Request ? input.url : input).includes('/api/telemetry/')) {
      counted.fartyReportsStarted += 1
    }
    return fetch(input, init)
  }
}

function reportsStarted(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { fartyReportsStarted: number }).fartyReportsStarted
  )
}

function reportsFrom(page: Page): Request[] {
  const sent: Request[] = []
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/telemetry/') sent.push(request)
  })
  return sent
}

async function reportAHandledErrorAndCrash(page: Page): Promise<void> {
  await page.goto('/dev/telemetry/')
  await page.getByRole('button', { name: 'Report a handled error' }).click()
  const crashed = page.waitForEvent('pageerror')
  await page.getByRole('button', { name: 'Crash' }).click()
  await crashed
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
    context,
    pageErrors
  }) => {
    pageErrors.expect(...errorsWhileOffline)
    const sent = reportsFrom(page)
    const queued = () =>
      page.evaluate(() => JSON.parse(localStorage.getItem('pedos.telemetry.queue') ?? '[]'))
    await page.goto('/dev/telemetry/')
    await context.setOffline(true)
    await page.getByRole('button', { name: 'Report a handled error' }).click()
    await expect.poll(queued).toHaveLength(1)
    expect(await reportsStarted(page)).toBe(0)
    expect(sent).toEqual([])

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

    await reportAHandledErrorAndCrash(page)
    expect(await reportsStarted(page)).toBe(0)
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

    await reportAHandledErrorAndCrash(page)
    expect(await reportsStarted(page)).toBe(0)
    expect(sent).toEqual([])
  })
})

test.describe('Production', () => {
  test.skip(!production, 'Only the Production build hides the triggers')

  test('the synthetic triggers are not found', async ({ request }) => {
    const response = await request.get('/dev/telemetry/', { maxRedirects: 0 })
    expect(response.status()).toBe(404)
  })
})
