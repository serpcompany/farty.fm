import { violations } from './accessibility'
import { newEmail } from './account'
import {
  recordG3ToRecordings,
  skipWelcome,
  waitForOpenMicrophone,
  withFartingMicrophone
} from './record'
import { pagesOutsideTheTabs } from './screens'
import {
  newHandle,
  shareARecording,
  shareAToot,
  signedInWithAHandle,
  someoneSignedOut
} from './sharing'
import { expect, test } from './test'

test('the first visit meets WCAG 2.1 AA', async ({ page }) => {
  await page.goto('/')
  expect(await violations(page)).toEqual([])
})

for (const path of ['/', '/recordings/', '/compose/', '/compose/mary/', '/toots/', '/profile/']) {
  test(`${path} meets WCAG 2.1 AA`, async ({ page }) => {
    test.setTimeout(120_000)
    await page.addInitScript(skipWelcome)
    await page.goto(path)
    expect(await violations(page)).toEqual([])
  })
}

test('the pages outside the tabs meet WCAG 2.1 AA', async ({ page, pageErrors }) => {
  pageErrors.expect('the server responded with a status of 404')
  for (const [path, shown] of pagesOutsideTheTabs(page)) {
    await page.goto(path)
    await expect(shown).toBeVisible()
    expect(await violations(page), path).toEqual([])
  }
})

test.describe('with a farting microphone', () => {
  withFartingMicrophone()

  test("the Sound Pad and a Pad's chooser meet WCAG 2.1 AA", async ({ page }) => {
    await recordG3ToRecordings(page)
    await page.goto('/compose/pad/')
    const pad = page.locator('[data-testid="pad"][data-pad="1"]')
    await expect(pad).toHaveAttribute('data-ready', 'true')
    expect.soft(await violations(page), 'the Pads').toEqual([])

    await page.getByRole('button', { name: 'Edit' }).click()
    await pad.click()
    await expect(page.getByRole('dialog', { name: 'Pad 1' })).toBeVisible()
    expect(await violations(page), 'the chooser').toEqual([])
  })

  test("Record's red Recording screen meets WCAG 2.1 AA", async ({ page }) => {
    await page.goto('/')
    await waitForOpenMicrophone(page)
    await page.getByTestId('record-button').click()
    await expect(page.getByTestId('stop-button')).toHaveAttribute('data-state', 'recording')
    expect(await violations(page)).toEqual([])
  })
})

test.describe('with a microphone that takes its time', () => {
  test.use({
    fakeMicrophone: { farts: false, answersAfterMs: 120_000 },
    permissions: ['microphone']
  })

  test("Record's Getting the mic ready screen meets WCAG 2.1 AA", async ({ page }) => {
    await page.addInitScript(skipWelcome)
    await page.goto('/')
    await page.getByTestId('record-button').click()
    await expect(page.getByTestId('record-getting-ready')).toBeVisible()
    expect(await violations(page)).toEqual([])
  })
})

test.describe('shared by link', () => {
  test.use({ serviceWorkers: 'block' })

  test("a profile page, and a shared Recording's and Toot's pages, meet WCAG 2.1 AA", async ({
    page,
    newContext
  }, testInfo) => {
    test.setTimeout(120_000)
    const handle = newHandle()
    await signedInWithAHandle(page, newEmail(testInfo, 'accessible'), handle)
    const recording = await shareARecording(page)
    const toot = await shareAToot(page)
    const viewer = await someoneSignedOut(newContext)
    for (const [path, shown] of [
      [`/u/${handle}/`, viewer.getByRole('heading', { name: `@${handle}` })],
      [recording, viewer.getByText(`@${handle} shared a Recording`)],
      [toot, viewer.getByText(`@${handle} shared a Toot`)]
    ] as const) {
      await viewer.goto(path)
      await expect(shown).toBeVisible()
      expect(await violations(viewer), path).toEqual([])
    }
  })
})

test('with reduced motion, nothing but a spinner moves for longer than a frame', async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(skipWelcome)
  await page.goto('/')
  await expect(page.getByTestId('record-button')).toBeVisible()
  const longestSeconds = await page.evaluate(() =>
    Math.max(
      0,
      ...[...document.querySelectorAll('*')]
        .filter(element => !element.classList.contains('animate-spin'))
        .flatMap(element => {
          const style = getComputedStyle(element)
          return [style.transitionDuration, style.animationDuration]
            .flatMap(durations => durations.split(','))
            .map(duration => Number.parseFloat(duration))
        })
    )
  )
  expect(longestSeconds).toBeLessThanOrEqual(0.001)
})
