import { randomInt } from 'node:crypto'
import { type BrowserContext, expect, type Page, test } from '@playwright/test'
import { codeFor, newEmail, ownClient, signInByApi } from './account'
import { recordAndSave, skipWelcome, withFakeMicrophone } from './record'
import { onPhone } from './screens'

// Sharing a Recording by link (#316, ADR 0020): the owner picks a Handle and shares, someone
// signed out opens the link in another browser and plays it, and once the owner stops sharing,
// the link is gone. A guest is asked to make a free account first. The record flow's Result
// shares the take just saved (#320).

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

  /** A link image's path, with the link's id swapped for `id`. */
  let imagePath = ''
  const imageOf = (id: string) => imagePath.replace(/\/r\/[0-9a-z]{12}\//, `/r/${id}/`)
  /** A link's page, audio and image all answer the not-found response. */
  const expectGone = async (path: string) => {
    const response = await other.goto(path)
    expect(response?.status()).toBe(404)
    await expect(
      other.getByRole('heading', { name: "This link doesn't work any more" })
    ).toBeVisible()
    expect((await other.request.get(`${path}audio/`)).status()).toBe(404)
    const id = path.split('/')[4]
    const picture = await other.request.get(imageOf(id))
    expect(picture.status()).toBe(404)
    // Next adds no-store and the rest to a 404 of its own.
    expect(picture.headers()['cache-control']).toMatch(/^private, no-cache\b/)
  }

  await test.step('someone signed out opens the link and plays it', async () => {
    const response = await other.goto(link)
    expect(response?.status()).toBe(200)
    // Nothing between keeps the page: a link that stops working stops at once.
    const pageCache = response?.headers()['cache-control'] ?? ''
    expect(pageCache).toContain('private')
    expect(pageCache).toContain('no-cache')
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
    imagePath = new URL(image ?? '').pathname + new URL(image ?? '').search
    expect(imagePath).toContain(link)
    const picture = await other.request.get(imagePath)
    expect(picture.status()).toBe(200)
    expect(picture.headers()['content-type']).toBe('image/png')
    expect(picture.headers()['cache-control']).toBe('private, no-cache')
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
    await expectGone(link)
  })

  await test.step('a link nobody shared is gone too', async () => {
    await expectGone(`/u/${handle}/r/000000000000/`)
  })

  await test.step('shared again, the new link is gone once the Recording is deleted', async () => {
    await page.getByRole('button', { name: 'Share Recording 1' }).click()
    // This page's own share sheet, since it loaded /recordings/: the new link only.
    await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(1)
    const again = new URL((await page.evaluate(() => window.__shared[0].url)) ?? '').pathname
    expect(again).toMatch(new RegExp(`^/u/${handle}/r/[0-9a-z]{12}/$`))
    expect(again).not.toBe(link)
    expect((await other.goto(again))?.status()).toBe(200)
    expect((await other.request.get(imageOf(again.split('/')[4]))).status()).toBe(200)

    await page.getByRole('button', { name: 'Delete Recording 1' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete Recording' }).click()
    await uploaded(page)
    await expectGone(again)
  })

  await viewer.close()
})

test("a guest records, reviews and saves, then shares from Result once they've made an account, and someone signed out plays it (#320)", async ({
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
  test.skip(!onPhone({ viewport }), 'Share from Result is checked at phone size')
  test.setTimeout(180_000)
  const handle = `e2e_${randomInt(1e9)}`
  const email = newEmail(testInfo, 'share-result')
  await ownClient(context)
  await fakeShareSheet(context)
  const page = await context.newPage()

  await test.step('records a G3, names it on its review, and saves it', async () => {
    await page.addInitScript(skipWelcome)
    await page.goto('/')
    await page.getByTestId('record-button').click()
    await expect(page.getByTestId('recording-timer')).toBeVisible()
    await page.waitForTimeout(1500)
    await page.getByTestId('stop-button').click()
    await expect(page.getByRole('heading', { name: 'New Recording' })).toBeVisible()
    // Not a Recording until it's saved, so there's nothing to share yet.
    await expect(page.getByRole('button', { name: /^Share/ })).toHaveCount(0)
    await page.getByRole('textbox', { name: 'Name' }).fill('Morning toot')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('result-note')).toHaveText('G3')
  })

  await test.step("Result's Share asks for a free account, then a Handle, then shares", async () => {
    await page.getByRole('button', { name: 'Share Morning toot' }).click()
    const step = page.getByRole('dialog', { name: 'Make a free account' })
    await expect(step.getByText('You need one to share. It keeps your farts too.')).toBeVisible()
    await step.getByLabel('Email').fill(email)
    await step.getByRole('button', { name: 'Send code' }).click()
    await step.getByLabel('Code').fill(await codeFor(page, email))
    await step.getByRole('button', { name: 'Sign in' }).click()
    await expect(step).toBeHidden()

    // Back on Result, Share carries on.
    const dialog = page.getByRole('alertdialog')
    await expect(dialog.getByRole('heading', { name: 'Pick a handle' })).toBeVisible()
    await dialog.getByRole('textbox', { name: 'Handle' }).fill(handle)
    await expect(dialog.getByText(`@${handle} is free`)).toBeVisible()
    await dialog.getByRole('button', { name: 'Share' }).click()
    await expect(dialog).toBeHidden()
    // The guest's take reaches the new account first, then the link goes to the share sheet.
    await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(1)
    const shared = await page.evaluate(() => window.__shared[0])
    expect(shared.title).toBe(`Morning toot by @${handle}`)
    expect(new URL(shared.url ?? '').pathname).toMatch(new RegExp(`^/u/${handle}/r/[0-9a-z]{12}/$`))
    await expect(page.getByTestId('result-note')).toHaveText('G3')
  })

  await test.step('someone signed out opens the link and plays it', async () => {
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
    const link = new URL((await page.evaluate(() => window.__shared[0].url)) ?? '').pathname
    expect((await other.goto(link))?.status()).toBe(200)
    await expect(other.getByText(`@${handle} shared a Recording`)).toBeVisible()
    await expect(other.getByRole('heading', { name: 'Morning toot' })).toBeVisible()
    await expect(other.getByTestId('shared-note')).toHaveText('G3')
    await other.getByRole('button', { name: 'Play Morning toot' }).click()
    await expect.poll(() => other.evaluate(() => window.__sounds.length)).toBe(1)
    const sound = await other.evaluate(() => window.__sounds[0])
    expect(sound.duration).toBeGreaterThan(0.2)
    expect(sound.peak).toBeGreaterThan(0.05)
    await viewer.close()
  })
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
