import { randomInt } from 'node:crypto'
import { type BrowserContext, expect, type Page, test } from '@playwright/test'
import { newEmail, signInByApi } from './account'
import { recordAndSave, withFakeMicrophone } from './record'

// Sharing a Recording by link (#316, ADR 0020): the owner picks a Handle and shares, someone
// signed out opens the link in another browser and plays it, and once the owner stops sharing,
// the link is gone. A guest is asked to make a free account first.

const g3 = '090__carlosramon__17-pet__186119.wav'
withFakeMicrophone(g3)

declare global {
  interface Window {
    /** What the page handed the share sheet. */
    __shared: ShareData[]
    /** Each sound the page starts: its length and loudest sample. */
    __sounds: { duration: number; peak: number }[]
  }
}

// A service worker would answer navigations itself, without the Staging gate's credentials.
test.use({ serviceWorkers: 'block' })

/** The share sheet, faked: it takes what it's handed, as tapping Copy in it would. */
async function fakeShareSheet(context: BrowserContext) {
  await context.addInitScript(() => {
    window.__shared = []
    navigator.share = async data => {
      window.__shared.push(data ?? {})
    }
  })
}

/** Counts each sound the page starts, with its length and loudest sample. */
async function listenToSounds(context: BrowserContext) {
  await context.addInitScript(() => {
    window.__sounds = []
    const start = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...args) {
      let peak = 0
      for (const sample of this.buffer?.getChannelData(0) ?? [])
        peak = Math.max(peak, Math.abs(sample))
      window.__sounds.push({ duration: this.buffer?.duration ?? 0, peak })
      return start.apply(this, args)
    }
  })
}

/** Waits until this browser's outbox is empty: the Recording is in the account. */
async function uploaded(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<number>((resolve, reject) => {
              const open = indexedDB.open('pedos')
              open.onerror = () => reject(open.error)
              open.onsuccess = () => {
                const request = open.result.transaction('outbox').objectStore('outbox').count()
                request.onsuccess = () => resolve(request.result)
                request.onerror = () => reject(request.error)
              }
            })
        ),
      { timeout: 60_000 }
    )
    .toBe(0)
}

test('a signed-in user shares a Recording, someone signed out plays it, and Stop sharing takes the link down', async ({
  context,
  browser,
  baseURL,
  httpCredentials,
  viewport,
  userAgent,
  deviceScaleFactor,
  isMobile,
  hasTouch
}, testInfo) => {
  test.setTimeout(180_000)
  const handle = `e2e_${randomInt(1e9)}`
  await fakeShareSheet(context)
  const page = await context.newPage()
  let link = ''

  await test.step('signs in and records a G3', async () => {
    await page.goto('/profile/')
    await signInByApi(page, newEmail(testInfo, 'share'))
    await recordAndSave(page, 1.5)
    await expect(page.getByTestId('result-note')).toHaveText('G3')
    await page.getByRole('button', { name: 'Done' }).click()
    await uploaded(page)
  })

  await test.step('picks a Handle the first time, then the link goes to the share sheet', async () => {
    await page.goto('/recordings/')
    await page.getByRole('button', { name: 'Share Recording 1' }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog.getByRole('heading', { name: 'Pick a handle' })).toBeVisible()
    const field = dialog.getByRole('textbox', { name: 'Handle' })
    await field.fill('farty')
    await expect(dialog.getByText("@farty isn't allowed. Try another.")).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Share' })).toBeDisabled()
    await field.fill(handle)
    await expect(dialog.getByText(`@${handle} is free`)).toBeVisible()
    await dialog.getByRole('button', { name: 'Share' }).click()
    await expect(dialog).toBeHidden()

    await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(1)
    const shared = await page.evaluate(() => window.__shared[0])
    expect(shared.title).toBe(`Recording 1 by @${handle}`)
    link = new URL(shared.url ?? '').pathname
    expect(link).toMatch(new RegExp(`^/u/${handle}/r/[0-9a-z]{12}/$`))
    await expect(page.getByTestId('recording-shared')).toHaveText('Shared')
  })

  await test.step('Profile shows the Handle', async () => {
    await page.goto('/profile/')
    await expect(page.getByTestId('account-handle')).toHaveText(`@${handle}`)
  })

  const viewer = await browser.newContext({
    baseURL,
    httpCredentials,
    viewport,
    userAgent,
    deviceScaleFactor,
    isMobile,
    hasTouch,
    serviceWorkers: 'block'
  })
  await listenToSounds(viewer)
  const other = await viewer.newPage()

  await test.step('someone signed out opens the link and plays it', async () => {
    const response = await other.goto(link)
    expect(response?.status()).toBe(200)
    await expect(other.getByText(`@${handle} shared a Recording`)).toBeVisible()
    await expect(other.getByRole('heading', { name: 'Recording 1' })).toBeVisible()
    await expect(other.getByTestId('shared-note')).toHaveText('G3')
    await expect(other.getByRole('link', { name: 'Get Farty' }).first()).toHaveAttribute(
      'href',
      '/'
    )
    await expect(other.getByRole('navigation', { name: 'Tabs' })).toHaveCount(0)

    // Unlisted, with a link preview.
    const meta = (property: string) =>
      other.locator(`meta[property="${property}"], meta[name="${property}"]`).first()
    await expect(meta('robots')).toHaveAttribute('content', /noindex/)
    await expect(meta('og:title')).toHaveAttribute('content', `Recording 1 by @${handle}`)
    await expect(meta('twitter:card')).toHaveAttribute('content', 'summary_large_image')
    const image = await meta('og:image').getAttribute('content')
    const picture = await other.request.get(new URL(image ?? '').pathname)
    expect(picture.status()).toBe(200)
    expect(picture.headers()['content-type']).toBe('image/png')
    expect((await picture.body()).byteLength).toBeGreaterThan(10_000)
    await testInfo.attach('og-image', { body: await picture.body(), contentType: 'image/png' })

    await other.getByRole('button', { name: 'Play Recording 1' }).click()
    await expect.poll(() => other.evaluate(() => window.__sounds.length)).toBe(1)
    const sound = await other.evaluate(() => window.__sounds[0])
    expect(sound.duration).toBeGreaterThan(1)
    expect(sound.peak).toBeGreaterThan(0.05)
  })

  await test.step('reports it', async () => {
    await other.getByRole('button', { name: 'Report' }).click()
    const dialog = other.getByRole('alertdialog')
    await expect(dialog.getByRole('heading', { name: 'Report this Recording?' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Report' }).click()
    await expect(other.getByText('Reported. Thanks.')).toBeVisible()
  })

  await test.step('the owner stops sharing, and the link is gone', async () => {
    await page.goto('/recordings/')
    await expect(page.getByTestId('recording-shared')).toBeVisible()
    await page.getByRole('button', { name: 'Share Recording 1' }).click()
    await page.getByRole('menuitem', { name: 'Stop sharing' }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog.getByRole('heading', { name: 'Stop sharing Recording 1?' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Stop sharing' }).click()
    await expect(page.getByTestId('recording-shared')).toHaveCount(0)

    const response = await other.goto(link)
    expect(response?.status()).toBe(404)
    await expect(
      other.getByRole('heading', { name: "This link doesn't work any more" })
    ).toBeVisible()
    expect((await other.request.get(`${link}audio/`)).status()).toBe(404)
  })

  await viewer.close()
})

test('a guest who taps Share is asked to make a free account first', async ({ context }) => {
  await fakeShareSheet(context)
  const page = await context.newPage()
  await recordAndSave(page, 1)
  await page.getByRole('button', { name: 'Done' }).click()
  await page.goto('/recordings/')
  await page.getByRole('button', { name: 'Share Recording 1' }).click()
  await expect(page.getByRole('heading', { name: 'Make a free account' })).toBeVisible()
  await expect(page.getByText('You need one to share. It keeps your farts too.')).toBeVisible()
  await page.getByRole('button', { name: 'Not now' }).click()
  await expect(page.getByRole('heading', { name: 'Make a free account' })).toBeHidden()
  expect(await page.evaluate(() => window.__shared.length)).toBe(0)
})
