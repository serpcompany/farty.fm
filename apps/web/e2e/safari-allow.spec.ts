import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { recordAndSave, withFakeMicrophone } from './record'

// How to set Safari's Microphone to Allow (#374), on iPhone Safari's user agent. Chromium's fake UI
// says granted from the start, which is what Safari says at Allow. At Ask, Safari says prompt until
// the page's own grant (seen on an iOS 27 Simulator), so `safariOnAsk` says that too. With
// E2E_EVIDENCE_DIR set, it also takes the PR's screenshots there.

const evidence = process.env.E2E_EVIDENCE_DIR ? resolve(process.env.E2E_EVIDENCE_DIR) : null
const iPhoneSafari =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1'

// Fixture 090 is Melodic (G3).
withFakeMicrophone('090__carlosramon__17-pet__186119.wav')
test.use({ userAgent: iPhoneSafari, serviceWorkers: 'block' })

test.beforeEach(({ browserName }, testInfo) => {
  test.skip(browserName !== 'chromium' || testInfo.project.name !== 'phone', 'An iPhone is a phone')
})

const note = (page: Page) => page.getByRole('dialog', { name: 'Make Farty louder' })
const tab = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Tabs' }).getByRole('link', { name, exact: true })

/** An init script: `permissions.query` as on iPhone Safari at Ask. */
function safariOnAsk() {
  let pageGranted = false
  const { mediaDevices, permissions } = navigator
  const getUserMedia = mediaDevices.getUserMedia.bind(mediaDevices)
  mediaDevices.getUserMedia = async constraints => {
    const stream = await getUserMedia(constraints)
    pageGranted = true
    return stream
  }
  const query = permissions.query.bind(permissions)
  permissions.query = async descriptor =>
    descriptor.name === ('microphone' as PermissionName)
      ? ({ state: pageGranted ? 'granted' : 'prompt' } as PermissionStatus)
      : query(descriptor)
}

async function microphoneSetting(page: Page) {
  return page.evaluate(async () => {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName })
    return status.state
  })
}

/** Records and saves a take, and finishes its Result. */
async function recordATake(page: Page) {
  await recordAndSave(page, 1.5)
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page).toHaveURL(/\/recordings\/$/)
}

test.describe('on Ask', () => {
  test.beforeEach(({ page }) => page.addInitScript(safariOnAsk))

  test('tells once, after the first take, and never again', async ({ page }, testInfo) => {
    test.setTimeout(120_000)
    const out = evidence && join(evidence, testInfo.project.name)
    if (out) mkdirSync(out, { recursive: true })

    await page.addInitScript(() => localStorage.setItem('pedos.welcomed', '1'))
    await page.goto('/compose/')
    expect(await microphoneSetting(page)).toBe('prompt')
    await expect(page.getByRole('heading', { name: 'Compose' })).toBeVisible()
    await expect(note(page), 'nothing granted yet').toHaveCount(0)

    await recordATake(page)
    await expect(note(page), 'not on another tab').toHaveCount(0)

    await tab(page, 'Compose').click()
    await expect(note(page)).toBeVisible()
    await expect(note(page)).toContainText('louder sound and no microphone question')
    await expect(note(page)).toContainText('Apps → Safari → Microphone → Allow')
    await expect(note(page)).toContainText('every website')
    await note(page).evaluate(el =>
      Promise.allSettled(el.getAnimations().map(animation => animation.finished)).then(() => null)
    )
    if (out) await page.screenshot({ path: join(out, 'safari-allow-note.png') })

    await page.getByRole('button', { name: 'Got it' }).click()
    await expect(note(page)).toHaveCount(0)

    await tab(page, 'Toots').click()
    await tab(page, 'Compose').click()
    await expect(page.getByRole('heading', { name: 'Compose' })).toBeVisible()
    await expect(note(page), 'not on coming back').toHaveCount(0)

    // The next launch, which gets the microphone again with the setting still on Ask.
    await recordATake(page)
    await tab(page, 'Compose').click()
    await expect(page.getByRole('heading', { name: 'Compose' })).toBeVisible()
    await expect(note(page), 'not on the next launch').toHaveCount(0)
  })

  test('tells after Welcome got the microphone', async ({ page }) => {
    await page.goto('/compose/')
    await page.getByRole('button', { name: 'Allow Microphone' }).click()
    await expect(note(page)).toBeVisible()
  })
})

test.describe('on Allow', () => {
  test.use({ permissions: ['microphone'] })

  test('never tells after a take', async ({ page }) => {
    test.setTimeout(120_000)
    await recordATake(page)
    expect(await microphoneSetting(page)).toBe('granted')

    await tab(page, 'Compose').click()
    await expect(page.getByRole('heading', { name: 'Compose' })).toBeVisible()
    await expect(note(page)).toHaveCount(0)
  })

  test('never tells after Welcome got the microphone', async ({ page }) => {
    await page.goto('/compose/')
    await page.getByRole('button', { name: 'Allow Microphone' }).click()
    await expect(page.getByRole('button', { name: 'Allow Microphone' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Compose' })).toBeVisible()
    await expect(note(page)).toHaveCount(0)
  })
})
