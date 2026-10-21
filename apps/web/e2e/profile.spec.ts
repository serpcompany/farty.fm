import { expect, test } from '@playwright/test'

// Profile's Install, the web app's own (#109's button): Chrome's prompt on Android, how to use the
// Share sheet on iPhone, and nothing where the browser can't install Farty or it's installed.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pedos.welcomed', '1'))
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

  test("Install app opens Chrome's prompt, and goes once Farty is installed", async ({ page }) => {
    await page.goto('/profile/')
    const install = page.getByRole('region', { name: 'Install' })
    const button = install.getByRole('button', { name: 'Install app' })
    const box = await button.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
    await button.click()
    expect(await page.evaluate(() => (window as unknown as { prompted: boolean }).prompted)).toBe(
      true
    )

    await page.reload()
    await expect(button).toBeVisible()
    // Chrome fires this when Farty is installed, from its prompt or its own menu.
    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')))
    await expect(install).toBeHidden()
  })
})

test.describe('on iPhone', () => {
  test.use({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
  })

  test('Install says how to add Farty to the Home Screen', async ({ page }) => {
    await page.goto('/profile/')
    await expect(page.getByRole('region', { name: 'Install' })).toHaveText(
      /^Install\s*Tap\s+Share, then Add to Home Screen$/
    )
  })
})

test("a browser that can't install Farty shows no Install", async ({ page }) => {
  await page.goto('/profile/')
  await expect(page.getByRole('region', { name: 'About' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Install' })).toHaveCount(0)
})
