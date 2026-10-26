import { expect, type Page, test } from '@playwright/test'

// Profile's Get the app (#217): what installing gives you, then the steps for the browser it's
// in: Chrome's prompt or menu on Android, the Share sheet on iPhone and iPad, Safari or the
// browser first from an in-app browser, a phone from a computer, and that Farty is installed.

const userAgents = {
  iPhoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  // iPadOS Safari reports itself as a Mac.
  iPadSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  iPhoneInstagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 400.0.0.0 (iPhone16,2; iOS 18_6; en_US)',
  androidInstagram:
    'Mozilla/5.0 (Linux; Android 15; Pixel 9 Build/AP3A.241105.008; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.7390.43 Mobile Safari/537.36 Instagram 400.0.0.0.0 Android',
  windowsChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
}

const intro = 'Add Farty to your Home Screen. It gets an icon and opens full screen, like an app.'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pedos.welcomed', '1'))
})

function getTheApp(page: Page) {
  return page.getByRole('region', { name: 'Get the app' })
}

/** Gives the page this many touch points, as an iPad (5) or a computer's mouse (0). */
async function touchPoints(page: Page, count: number) {
  await page.addInitScript(points => {
    Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => points })
  }, count)
}

/** Opens Profile as Chrome does an installed app, full screen from the Home Screen. */
async function openInstalled(page: Page) {
  // Chromium can't emulate display-mode, so this answers its query.
  await page.addInitScript(() => {
    const matchMedia = window.matchMedia.bind(window)
    window.matchMedia = query => {
      const list = matchMedia(query)
      if (query === '(display-mode: standalone)') {
        Object.defineProperty(list, 'matches', { value: true })
      }
      return list
    }
  })
  await page.goto('/profile/')
}

test.describe('on Android', () => {
  test("says to install from the browser's menu before Chrome offers its prompt", async ({
    page
  }) => {
    await page.goto('/profile/')
    const section = getTheApp(page)
    await expect(section.getByRole('paragraph')).toHaveText(intro)
    await expect(section.getByRole('listitem')).toHaveText([
      'Tap the menu in your browser.',
      "Tap Install app or Add to Home screen. Scroll down if you don't see it.",
      'Tap Install.'
    ])
    await expect(section.getByRole('button')).toHaveCount(0)
  })

  test.describe('once Chrome offers its prompt', () => {
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

    test("Install app opens Chrome's prompt, and Profile says once Farty is installed", async ({
      page
    }) => {
      await page.goto('/profile/')
      const section = getTheApp(page)
      const button = section.getByRole('button', { name: 'Install app' })
      await expect(section.getByRole('paragraph')).toHaveText(intro)
      const box = await button.boundingBox()
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
      await button.click()
      expect(await page.evaluate(() => (window as unknown as { prompted: boolean }).prompted)).toBe(
        true
      )
      // Each prompt shows once, so until Chrome offers it again, the menu's steps show.
      await expect(button).toBeHidden()
      await expect(section.getByRole('listitem')).toHaveCount(3)

      await page.reload()
      await expect(button).toBeVisible()
      // Chrome fires this when Farty is installed, from its prompt or its own menu.
      await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')))
      await expect(section).toHaveText(
        /^Get the app\s*Farty is installed\s*It's on your Home Screen and opens full screen, like an app\.$/
      )
    })
  })

  test('says Farty is installed when it opens from the Home Screen', async ({ page }) => {
    await openInstalled(page)
    const section = getTheApp(page)
    await expect(section.getByText('Farty is installed', { exact: true })).toBeVisible()
    await expect(section.getByRole('listitem')).toHaveCount(0)
    await expect(section.getByRole('button')).toHaveCount(0)
  })

  test.describe('in an in-app browser', () => {
    test.use({ userAgent: userAgents.androidInstagram })

    test('says to open the page in the browser first', async ({ page }) => {
      await page.goto('/profile/')
      await expect(getTheApp(page).getByRole('listitem')).toHaveText([
        "In this app's menu, tap Open in Chrome or Open in browser.",
        'In your browser, follow the steps that show here.'
      ])
    })
  })
})

const shareSheetSteps = [
  "Tap Share . If you don't see it, tap More first.",
  'Tap Add to Home Screen. Scroll down or tap View More to find it.',
  'Tap Add.'
]

test.describe('on iPhone', () => {
  test.use({ userAgent: userAgents.iPhoneSafari })

  test('says how to add Farty to the Home Screen from the Share sheet', async ({ page }) => {
    await page.goto('/profile/')
    const section = getTheApp(page)
    await expect(section.getByRole('paragraph')).toHaveText(intro)
    await expect(section.getByRole('listitem')).toHaveText(shareSheetSteps)
    await expect(section.getByRole('button')).toHaveCount(0)
  })

  test('says Farty is installed when it opens from the Home Screen', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true })
    })
    await page.goto('/profile/')
    const section = getTheApp(page)
    await expect(section.getByText('Farty is installed', { exact: true })).toBeVisible()
    await expect(section.getByRole('listitem')).toHaveCount(0)
  })

  test.describe('in an in-app browser', () => {
    test.use({ userAgent: userAgents.iPhoneInstagram })

    test('says to open the page in Safari first', async ({ page }) => {
      await page.goto('/profile/')
      await expect(getTheApp(page).getByRole('listitem')).toHaveText([
        "In this app's menu, tap Open in Safari or Open in browser.",
        'In Safari, follow the steps that show here.'
      ])
    })
  })
})

test.describe('on iPad', () => {
  test.use({ userAgent: userAgents.iPadSafari })

  test('says how to add Farty to the Home Screen from the Share sheet', async ({ page }) => {
    await touchPoints(page, 5)
    await page.goto('/profile/')
    await expect(getTheApp(page).getByRole('listitem')).toHaveText(shareSheetSteps)
  })
})

test.describe('on a computer', () => {
  test.use({ userAgent: userAgents.windowsChrome })

  test('says Farty is a phone app', async ({ page }) => {
    await touchPoints(page, 0)
    await page.goto('/profile/')
    await expect(getTheApp(page)).toHaveText(
      /^Get the app\s*Farty is a phone app\. Open this page on your phone to add it to your Home Screen\.$/
    )
  })
})
