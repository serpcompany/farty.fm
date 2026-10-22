import { expect, type Page, test } from '@playwright/test'
import { songs } from '../src/lib/catalog/songs.generated'
import { fakeMicrophone, microphone, waitForOpenMicrophone } from './fake-microphone'
import { skipWelcome } from './record'

// On a computer, a wide window with a mouse, Farty is a phone app (#199): every tab is the product
// page, and Download App shows a QR code to open Farty on a phone. Only the desktop project runs
// this file.

function hero(page: Page) {
  return page.getByRole('heading', { name: 'Record your farts. Turn them into songs.', level: 1 })
}

/** The product page, with nothing that opens the app. */
async function expectProductPage(page: Page) {
  await expect(hero(page)).toBeVisible()
  // The app, its tabs included, is hidden.
  await expect(page.locator('#app')).toBeHidden()
  await expect(page.getByRole('navigation', { name: 'Tabs' })).toBeHidden()
  const lander = page.locator('#top')
  // The only buttons are Download App's, in the top bar, the hero and the closing band.
  await expect(lander.getByRole('button')).toHaveText([
    'Download App',
    'Download App',
    'Download App'
  ])
  // The links stay on the page, or go to Privacy and Support.
  const links = await lander
    .getByRole('link')
    .evaluateAll(all => all.map(link => link.getAttribute('href')))
  expect(new Set(links)).toEqual(
    new Set(['#top', '#features', '#how-it-works', '#faq', '/support/', '/privacy/'])
  )
}

for (const [where, path] of [
  ['Record', '/'],
  ['Compose', '/compose/'],
  ["a Song's link", `/compose/${songs[0].id}/`],
  ['Profile', '/profile/']
]) {
  test(`${where} shows the product page`, async ({ page }) => {
    await page.goto(path)
    await expectProductPage(page)
  })
}

test('a browser that opened Farty before still gets the product page, and the microphone stays shut', async ({
  page,
  context
}) => {
  await context.grantPermissions(['microphone'])
  await page.addInitScript(skipWelcome, {})
  await page.addInitScript(() => {
    const opened = { count: 0 }
    Object.assign(window, { microphoneOpened: opened })
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = constraints => {
      opened.count += 1
      return getUserMedia(constraints)
    }
  })
  await page.goto('/')
  await expectProductPage(page)
  await page.waitForLoadState('networkidle')
  expect(await page.evaluate(() => Reflect.get(window, 'microphoneOpened').count)).toBe(0)
})

test('widening a narrow window into the product page shuts the microphone', async ({
  page,
  context
}) => {
  await context.grantPermissions(['microphone'])
  await page.addInitScript(fakeMicrophone, { wavs: {}, delayMs: 0 })
  await page.addInitScript(skipWelcome, {})
  // Narrower than 768px, a computer gets the phone app, and Record opens the microphone.
  await page.setViewportSize({ width: 700, height: 900 })
  await page.goto('/')
  await expect(page.getByTestId('record-button')).toBeVisible()
  await waitForOpenMicrophone(page)

  await page.setViewportSize({ width: 1440, height: 900 })
  await expectProductPage(page)
  await expect.poll(async () => (await microphone(page)).live).toBe(0)
  const mic = await microphone(page)
  expect(mic.nodes - mic.closed).toBe(0)
})

test('coming back to the page leaves the product page where it was', async ({ page }) => {
  await page.goto('/compose/')
  await expectProductPage(page)
  await page.getByRole('link', { name: 'FAQ' }).click()
  await expect(page).toHaveURL(/\/compose\/#faq$/)
  for (const state of ['hidden', 'visible']) {
    await page.evaluate(state => {
      Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    }, state)
  }
  // On a phone or tablet, coming back to a tab other than Record opens Record.
  await page.waitForTimeout(500)
  await expect(page).toHaveURL(/\/compose\/#faq$/)
})

test('Download App shows a QR code for a phone; Escape closes it and gives focus back', async ({
  page
}) => {
  await page.goto('/')
  for (const index of [0, 1, 2]) {
    const button = page.getByRole('button', { name: 'Download App' }).nth(index)
    await button.click()

    const dialog = page.getByRole('dialog', { name: 'Scan to open Farty on your phone' })
    await expect(dialog).toBeVisible()
    const code = dialog.getByRole('img', { name: /^QR code for (staging\.)?farty\.fm$/ })
    await expect(code).toBeVisible()
    expect(await code.evaluate(element => element.tagName)).toBe('svg')
    await expect(dialog).toContainText('Then add it to your Home Screen.')

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(button).toBeFocused()
  }
})

test('the privacy, support and 404 pages stay pages, with no tabs', async ({ page }) => {
  for (const [path, content] of [
    ['/privacy/', page.getByRole('heading', { name: 'Privacy', level: 1 })],
    ['/support/', page.getByRole('heading', { name: 'Support', level: 1 })],
    ['/nope/', page.getByText('Page not found')]
  ] as const) {
    await page.goto(path)
    await expect(content).toBeVisible()
    await expect(hero(page)).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Recordings' })).toBeHidden()
  }
})
