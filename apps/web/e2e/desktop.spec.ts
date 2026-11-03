import type { Page } from '@playwright/test'
import { songs } from '../src/test-support/songs.generated'
import { violations } from './accessibility'
import { addFakeMicrophone } from './fake-microphone'
import { microphone, skipWelcome, waitForOpenMicrophone } from './record'
import { comeBack, hero, pageSettled, pagesOutsideTheTabs } from './screens'
import { expect, test } from './test'

async function expectProductPage(page: Page) {
  await expect(hero(page)).toBeVisible()
  await expect(page.locator('#app')).toBeHidden()
  await expect(page.getByRole('navigation', { name: 'Tabs' })).toBeHidden()
  const lander = page.locator('#top')
  await expect(lander.getByRole('button')).toHaveText([
    'Download App',
    'Download App',
    'Download App'
  ])
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

test('the product page meets WCAG 2.1 AA, in light and dark', async ({ page }) => {
  await page.goto('/')
  await expect(hero(page)).toBeVisible()
  expect(await violations(page)).toEqual([])
})

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
  await addFakeMicrophone(context, { farts: false })
  await page.addInitScript(skipWelcome, {})
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
  await comeBack(page)
  await pageSettled(page)
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

test("a shared page's Get Farty shows the QR code, not the account step (#318)", async ({
  page,
  pageErrors
}) => {
  pageErrors.expect('the server responded with a status of 404')
  await page.goto('/u/nobody/r/AAAAAAAAAAAA/')
  await expect(page.getByRole('heading', { name: "This link doesn't work any more" })).toBeVisible()
  const getFarty = page.getByRole('button', { name: 'Get Farty' })
  await expect(getFarty).toHaveCount(2)
  for (const index of [0, 1]) {
    await getFarty.nth(index).click()
    const dialog = page.getByRole('dialog', { name: 'Scan to open Farty on your phone' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('img', { name: /^QR code for / })).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Make a free account' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(getFarty.nth(index)).toBeFocused()
  }
})

test('the privacy, support and 404 pages stay pages, with no tabs', async ({
  page,
  pageErrors
}) => {
  pageErrors.expect('the server responded with a status of 404')
  for (const [path, content] of pagesOutsideTheTabs(page)) {
    await page.goto(path)
    await expect(content).toBeVisible()
    await expect(hero(page)).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Recordings' })).toBeHidden()
  }
})
