import { randomInt } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { type BrowserContext, expect, type Page, type TestInfo, test } from '@playwright/test'
import { songs } from '../src/lib/catalog/songs.generated'
import { slugify } from '../src/lib/slug'
import {
  codeFor,
  fromTheLocalDatabase,
  newEmail,
  onTheLocalDatabase,
  ownClient,
  signInByApi
} from './account'
import { payToSave } from './pay'
import { recordAndSave, skipWelcome, withFakeMicrophone } from './record'
import { onPhone } from './screens'

// Sharing a Recording (#316) or a saved Toot (#317) by link (ADR 0020): the owner picks a Handle
// and shares, someone signed out opens the link in another browser and plays it, and once the
// owner stops sharing, the link is gone. A guest is asked to make a free account first. The record
// flow's Result shares the take just saved (#320). The owner's page lists a shared Toot beside a
// shared Recording, and plays it (#346).
//
// With E2E_EVIDENCE_DIR set, the Toot's journey also writes its screenshots and link image there,
// for the PR.

const g3 = '090__carlosramon__17-pet__186119.wav'
const twinkle = songs.find(song => song.id === 'twinkle')?.title ?? 'twinkle'
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

const evidence = process.env.E2E_EVIDENCE_DIR ? resolve(process.env.E2E_EVIDENCE_DIR) : null

/** Where this run keeps its screenshots, if it does, and what takes one. */
function evidenceFor(testInfo: TestInfo) {
  const out = evidence && join(evidence, testInfo.project.name)
  if (out) mkdirSync(out, { recursive: true })
  const shot = async (on: Page, name: string) => {
    // Menus and dialogs fade in: each is shot as it ends up.
    if (out) await on.screenshot({ path: join(out, `${name}.png`), animations: 'disabled' })
  }
  /** The whole page at `width` as well, then back to this project's size. */
  const wideShot = async (on: Page, name: string, width: number, height: number) => {
    const size = on.viewportSize()
    if (!out || !size) return
    await on.setViewportSize({ width, height })
    await on.screenshot({ path: join(out, `${name}.png`), fullPage: true })
    await on.setViewportSize(size)
  }
  /** At a computer's 1280 px and a small phone's 375 px. */
  const computerShot = async (on: Page, name: string) => {
    await wideShot(on, `${name}-computer`, 1280, 800)
    await wideShot(on, `${name}-375`, 375, 812)
  }
  return { out, shot, computerShot }
}

/** How far the page scrolls sideways at a 375 px phone's width, then back to `on`'s own size. */
async function sidewaysAt375(on: Page): Promise<number> {
  const size = on.viewportSize()
  await on.setViewportSize({ width: 375, height: 812 })
  const overflow = await on.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  )
  if (size) await on.setViewportSize(size)
  return overflow
}

/**
 * At a computer's 1280 px, each share row is laid out as SoundCloud's (#448, #451): its 160 px
 * picture down the left; the day at the top right, over the end of its waveform; the waveform,
 * with its length at its right, and Copy link in the column right of the picture; and the page no
 * wider than `max-w-6xl`. Then back to `on`'s own size.
 */
async function expectComputerRows(on: Page) {
  const size = on.viewportSize()
  await on.setViewportSize({ width: 1280, height: 800 })
  const rows = on.getByTestId('profile-shared-item')
  await expect(rows.first()).toBeVisible()
  for (const row of await rows.all()) {
    const art = await row.getByTestId('profile-shared-art').boundingBox()
    const wave = await row.getByTestId('replay-waveform').boundingBox()
    const copy = await row.getByTestId('profile-copy-link').boundingBox()
    const date = await row.getByTestId('profile-shared-date').boundingBox()
    const length = await row.getByTestId('profile-shared-length').boundingBox()
    if (!art || !wave || !copy || !date || !length)
      throw new Error('A row is missing its picture, waveform, day, length or Copy link')
    expect(Math.round(art.width)).toBe(160)
    expect(Math.round(art.height)).toBe(160)
    expect(wave.x).toBeGreaterThanOrEqual(art.x + art.width)
    expect(copy.x).toBeGreaterThanOrEqual(art.x + art.width)
    // On a phone, the waveform spans the whole row under the picture instead.
    expect(wave.y).toBeLessThan(art.y + art.height)
    expect(date.y + date.height).toBeLessThanOrEqual(wave.y)
    expect(Math.abs(date.x + date.width - (wave.x + wave.width))).toBeLessThan(2)
    expect(Math.abs(length.x + length.width - (wave.x + wave.width))).toBeLessThan(2)
    expect(length.y).toBeGreaterThan(wave.y)
  }
  const list = await on.locator('ul', { has: rows.first() }).boundingBox()
  expect(list?.width ?? 0).toBeLessThanOrEqual(1152)
  if (size) await on.setViewportSize(size)
}

/** Says each of `handle`'s Recordings was made in Testville: the real reading is wherever this runs. */
function madeInTestville(handle: string) {
  const place = { city: 'Testville', region: 'Texas', country: 'US', timeZone: 'America/Chicago' }
  onTheLocalDatabase(
    `UPDATE recordings SET place = '${JSON.stringify(place)}'
     WHERE user_id = (SELECT user_id FROM handles WHERE handle = '${handle}')`
  )
}

/** Sets Profile's Show where I farted by its whole row, in a tab of its own, and the account keeps it. */
async function showWhereIFarted(context: BrowserContext, on: boolean) {
  const tab = await context.newPage()
  await tab.goto('/profile/')
  const control = tab.getByRole('switch', { name: 'Show where I farted' })
  await expect(control).toBeChecked({ checked: !on })
  await tab.locator('label', { has: control }).click()
  await expect(control).toBeChecked({ checked: on })
  await tab.reload()
  await expect(control).toBeChecked({ checked: on })
  await tab.close()
}

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

/** Waits until this browser's outbox is empty: the Recording or Toot is in the account. */
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

/**
 * A link's page, audio and link image (`image`, its path) all answer not found, to `viewer`,
 * someone signed out.
 */
async function expectGone(viewer: Page, path: string, image: string) {
  const response = await viewer.goto(path)
  expect(response?.status()).toBe(404)
  await expect(
    viewer.getByRole('heading', { name: "This link doesn't work any more" })
  ).toBeVisible()
  expect((await viewer.request.get(`${path}audio/`)).status()).toBe(404)
  const picture = await viewer.request.get(image)
  expect(picture.status()).toBe(404)
  // Next adds no-store and the rest to a 404 of its own.
  expect(picture.headers()['cache-control']).toMatch(/^private, no-cache\b/)
}

/** Loads the Fixture Library from Profile, which unlocks most Songs (`golden.ts`). */
async function loadTheFixtureLibrary(page: Page) {
  const library = page.getByTestId('fixture-library')
  await library.getByRole('button', { name: 'Load the Fixture Library' }).click()
  await expect(library.getByRole('button', { name: 'Fixture Library loaded' })).toBeDisabled({
    timeout: 90_000
  })
}

/** A saved Toot's audio, as this browser keeps it in IndexedDB. */
async function storedTootWav(page: Page, id: string): Promise<Buffer> {
  const dataUrl = await page.evaluate(async id => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('pedos')
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    const wav = await new Promise<ArrayBuffer>((resolve, reject) => {
      const read = db.transaction('tootAudio').objectStore('tootAudio').get(id)
      read.onsuccess = () => resolve(read.result)
      read.onerror = () => reject(read.error)
    })
    db.close()
    return new Promise<string>(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.readAsDataURL(new Blob([wav]))
    })
  }, id)
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
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
  const { shot } = evidenceFor(testInfo)
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
    expect(link).toMatch(new RegExp(`^/@${handle}/r/recording-\\d+/$`))
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

  /** The link image's path, as the page names it in its link preview. */
  let imagePath = ''
  /** The link image's path for the link at `path`. */
  const imageOf = (path: string) => imagePath.replace(link, path)
  const gone = (path: string) => expectGone(other, path, imageOf(path))

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
    await expect(other.getByTestId('shared-recorded-at')).toHaveText(/^Recorded .*\d{4}/)
    // Signed out, Get Farty starts Get Farty here (#318), so it's a button, not a link to `/`.
    await expect(other.getByRole('button', { name: 'Get Farty' }).first()).toBeVisible()
    await expect(other.getByRole('link', { name: 'Get Farty' })).toHaveCount(0)
    // The site's own footer and tabs, as anywhere else on Farty (#441).
    await expect(other.getByRole('navigation', { name: 'Footer' })).toBeVisible()
    if (onPhone({ viewport: other.viewportSize() })) {
      await expect(other.getByRole('navigation', { name: 'Tabs' })).toBeVisible()
    }

    // Unlisted, with a link preview.
    const meta = (property: string) =>
      other.locator(`meta[property="${property}"], meta[name="${property}"]`).first()
    await expect(meta('robots')).toHaveAttribute('content', /noindex/)
    await expect(meta('og:title')).toHaveAttribute('content', `Recording 1 by @${handle}`)
    // The share URL, at `/@`: no canonical, as it's unlisted.
    expect(new URL((await meta('og:url').getAttribute('content')) ?? '').pathname).toBe(link)
    await expect(other.locator('link[rel="canonical"]')).toHaveCount(0)
    await expect(meta('twitter:card')).toHaveAttribute('content', 'summary_large_image')
    const image = await meta('og:image').getAttribute('content')
    imagePath = new URL(image ?? '').pathname + new URL(image ?? '').search
    expect(imagePath).toBe(`${link}image/`)
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

  await test.step('it says where the fart was made, until the owner turns that off (#444)', async () => {
    // What the upload kept of this run's connection: nothing finer than a city.
    const [{ place }] = fromTheLocalDatabase<{ place: string | null }>(
      `SELECT place FROM recordings
       WHERE user_id = (SELECT user_id FROM handles WHERE handle = '${handle}')`
    )
    const kept = JSON.parse(place ?? 'null')
    expect(Object.keys(kept ?? {}).sort()).toEqual(['city', 'country', 'region', 'timeZone'])
    expect(kept.country).toMatch(/^[A-Z]{2}$/)

    madeInTestville(handle)
    await other.goto(link)
    const recorded = other.getByTestId('shared-recorded-at')
    await expect(recorded).toHaveText(/^Recorded .*\d{4}.* · Testville, Texas$/)
    await shot(other, 'recording-shared-place')
    // Never in a link preview, which goes where the switch can't reach it.
    await expect(other.locator('meta[content*="Testville"]')).toHaveCount(0)

    await showWhereIFarted(context, false)
    await other.goto(link)
    await expect(recorded).toHaveText(/^Recorded .*\d{4}/)
    expect(await other.content()).not.toContain('Testville')

    // Off forgets it, so on again doesn't put it back on a link already sent.
    await showWhereIFarted(context, true)
    await other.goto(link)
    await expect(recorded).toHaveText(/^Recorded .*\d{4}/)
    expect(await other.content()).not.toContain('Testville')
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
    await gone(link)
  })

  await test.step('a link nobody shared is gone too', async () => {
    await gone(`/@${handle}/r/000000000000/`)
  })

  await test.step('shared again, the link is back, and gone once the Recording is deleted', async () => {
    await page.getByRole('button', { name: 'Share Recording 1' }).click()
    // This page's own share sheet, since it loaded /recordings/: this share only.
    await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(1)
    const again = new URL((await page.evaluate(() => window.__shared[0].url)) ?? '').pathname
    expect(again).toBe(link)
    expect((await other.goto(again))?.status()).toBe(200)
    expect((await other.request.get(imageOf(again))).status()).toBe(200)

    await page.getByRole('button', { name: 'Delete Recording 1' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete Recording' }).click()
    await uploaded(page)
    await gone(again)
  })

  await viewer.close()
})

test('a signed-in user shares a saved Toot, someone signed out plays it, and Stop sharing takes the link down', async ({
  context,
  browser,
  request,
  baseURL,
  httpCredentials,
  viewport,
  userAgent,
  deviceScaleFactor,
  isMobile,
  hasTouch
}, testInfo) => {
  // A Song's Toot plays Recordings of its notes: the Fixture Library's, in the Staging build only.
  const onStagingBuild =
    process.env.E2E_SERVER === 'preview' &&
    (await request.get('/fixtures/recordings/index.json')).ok()
  test.skip(
    !onStagingBuild,
    'The Fixture Library is only in the Staging build (pnpm build:staging)'
  )
  test.setTimeout(300_000)
  const { out, shot, computerShot } = evidenceFor(testInfo)
  const handle = `e2e_${randomInt(1e9)}`
  await fakeShareSheet(context)
  await context.addInitScript(skipWelcome)
  const page = await context.newPage()
  const shareSheet = () => page.evaluate(() => window.__shared.map(shared => shared.url ?? ''))
  let tootId = ''
  let title = ''
  let link = ''
  const email = newEmail(testInfo, 'share-toot')

  await test.step(`signs in and saves a Toot of ${twinkle}`, async () => {
    await page.goto('/profile/')
    await signInByApi(page, email)
    await page.goto('/profile/')
    await loadTheFixtureLibrary(page)
    await page.goto('/compose/twinkle/')
    await expect(page.getByTestId('song-creator-state')).toBeVisible({ timeout: 60_000 })
    await payToSave(page)
    await uploaded(page)
  })

  await test.step("picks a Handle the first time, from the Toot's row, then the link goes to the share sheet", async () => {
    await page.goto('/toots/')
    const row = page.getByTestId('toot-row')
    await expect(row).toHaveCount(1)
    title = (await row.getByRole('link').locator('span').first().textContent()) ?? ''
    expect(title).toBe(twinkle)
    await row.getByRole('button', { name: `More for ${title}` }).click()
    await shot(page, 'toot-row-menu')
    await page.getByRole('menuitem', { name: 'Share', exact: true }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog.getByRole('heading', { name: 'Pick a handle' })).toBeVisible()
    await dialog.getByRole('textbox', { name: 'Handle' }).fill(handle)
    await expect(dialog.getByText(`@${handle} is free`)).toBeVisible()
    await shot(page, 'toot-handle')
    await dialog.getByRole('button', { name: 'Share' }).click()
    await expect(dialog).toBeHidden()

    await expect.poll(shareSheet).toHaveLength(1)
    expect(await page.evaluate(() => window.__shared[0].title)).toBe(`${title} by @${handle}`)
    link = new URL((await shareSheet())[0]).pathname
    expect(link).toBe(`/@${handle}/t/${slugify(twinkle, 'toot')}/`)
  })

  await test.step("the Toot's screen says it's shared, and its header's Share offers the same link", async () => {
    await page.getByTestId('toot-row').getByRole('link').click()
    await expect(page).toHaveURL(/\/toots\/toot\/\?id=/)
    tootId = new URL(page.url()).searchParams.get('id') ?? ''
    await expect(page.getByTestId('toot-subtitle')).toHaveText(`${title} · Shared`)
    await shot(page, 'toot-screen-shared')
    await page.getByRole('button', { name: `Share ${title}` }).click()
    await expect(page.getByRole('menuitem', { name: 'Stop sharing' })).toBeVisible()
    await page.getByRole('menuitem', { name: 'Share link' }).click()
    await expect.poll(shareSheet).toHaveLength(2)
    expect(new URL((await shareSheet())[1]).pathname).toBe(link)
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
  /** The link image's path, as the page names it in its link preview. */
  let imagePath = ''
  const imageOf = (path: string) => imagePath.replace(link, path)

  await test.step('someone signed out opens the link and plays the Toot as it was saved', async () => {
    const response = await other.goto(link)
    expect(response?.status()).toBe(200)
    const pageCache = response?.headers()['cache-control'] ?? ''
    expect(pageCache).toContain('private')
    expect(pageCache).toContain('no-cache')
    await expect(other.getByText(`@${handle} shared a Toot`)).toBeVisible()
    await expect(other.getByRole('heading', { name: title })).toBeVisible()
    // Named for its Song, so the Song isn't said twice.
    await expect(other.getByTestId('shared-song')).toHaveCount(0)
    await shot(other, 'toot-shared-page')

    // Nothing private: not the Toot's id nor its owner's email, in the HTML or its page data.
    const html = (await response?.text()) ?? ''
    expect(html).toContain(title)
    for (const secret of [tootId, email]) {
      expect(html).not.toContain(secret)
      expect(await other.content()).not.toContain(secret)
    }

    // Unlisted, with a link preview of its own.
    const meta = (property: string) =>
      other.locator(`meta[property="${property}"], meta[name="${property}"]`).first()
    await expect(meta('robots')).toHaveAttribute('content', /noindex/)
    await expect(meta('og:title')).toHaveAttribute('content', `${title} by @${handle}`)
    // The share URL, at `/@`: no canonical, as it's unlisted.
    expect(new URL((await meta('og:url').getAttribute('content')) ?? '').pathname).toBe(link)
    await expect(other.locator('link[rel="canonical"]')).toHaveCount(0)
    await expect(meta('og:description')).toHaveAttribute(
      'content',
      `${twinkle}, played on farts. Tap to play.`
    )
    await expect(meta('twitter:card')).toHaveAttribute('content', 'summary_large_image')
    const image = new URL((await meta('og:image').getAttribute('content')) ?? '')
    imagePath = image.pathname + image.search
    expect(imagePath).toBe(`${link}image/`)
    const picture = await other.request.get(imagePath)
    expect(picture.status()).toBe(200)
    expect(picture.headers()['content-type']).toBe('image/png')
    expect(picture.headers()['cache-control']).toBe('private, no-cache')
    expect((await picture.body()).byteLength).toBeGreaterThan(10_000)
    await testInfo.attach('toot-og-image', { body: await picture.body(), contentType: 'image/png' })
    if (out) writeFileSync(join(out, 'toot-og-image.png'), await picture.body())

    // The audio is the Toot's saved WAV, byte for byte: nothing rendered for the link.
    const audio = await other.request.get(`${link}audio/`)
    expect(audio.status()).toBe(200)
    expect(audio.headers()['cache-control']).toBe('private, no-cache')
    const saved = await storedTootWav(page, tootId)
    expect((await audio.body()).equals(saved)).toBe(true)

    await other.getByRole('button', { name: `Play ${title}` }).click()
    await expect.poll(() => other.evaluate(() => window.__sounds.length)).toBe(1)
    const sound = await other.evaluate(() => window.__sounds[0])
    expect(sound.duration).toBeGreaterThan(1)
    expect(sound.peak).toBeGreaterThan(0.05)
    await expect(other.getByRole('button', { name: `Stop ${title}` })).toBeVisible()
    await shot(other, 'toot-shared-playing')
  })

  await test.step('they see its notes and each fart, with when it was recorded, and play one alone (#443)', async () => {
    const roll = other.getByTestId('note-view')
    await expect(roll).toBeVisible()
    await expect(roll.getByTestId('playhead')).toBeVisible()
    // The screen it was made on (#451): Song Creator's Play and roll, then Recordings used.
    await expect(other.getByTestId('shared-toot-state')).toHaveText('Playing')
    await expect(other.getByRole('heading', { name: 'Recordings used' })).toBeVisible()
    await other.getByRole('button', { name: `Stop ${title}` }).click()

    const farts = other.getByTestId('recording-used')
    await expect(farts.first()).toContainText(/plays /)
    await expect(farts.first()).toContainText(/\d{4}/)
    await shot(other, 'toot-shared-parts')

    // Nothing names a Recording: no id of any kind on the page, and a fart's audio is by its place.
    expect(await other.content()).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i)
    const before = await other.evaluate(() => window.__sounds.length)
    const fart = other.waitForResponse(response =>
      new URL(response.url()).pathname.endsWith(`${link}farts/0/audio/`)
    )
    await farts.first().getByRole('button').first().click()
    expect((await fart).status()).toBe(200)
    await expect.poll(() => other.evaluate(() => window.__sounds.length)).toBe(before + 1)
    const played = await other.evaluate(() => window.__sounds.at(-1))
    expect(played?.peak).toBeGreaterThan(0.05)
    await expect(farts.first().getByRole('button').first()).toHaveAttribute('aria-pressed', 'true')
    // Only that fart: the Toot's own Play isn't playing.
    await expect(other.getByRole('button', { name: `Play ${title}` })).toBeVisible()
    await farts.first().getByRole('button').first().click()
    await expect(farts.first().getByRole('button').first()).toHaveAttribute('aria-pressed', 'false')
  })

  await test.step('each fart says where it was made, until the owner turns that off (#444)', async () => {
    madeInTestville(handle)
    await other.goto(link)
    const fart = other.getByTestId('recording-used').first()
    await expect(fart).toContainText('Testville, Texas')
    await shot(other, 'toot-shared-place')

    await showWhereIFarted(context, false)
    await other.goto(link)
    await expect(fart).toContainText(/\d{4}/)
    expect(await other.content()).not.toContain('Testville')
    await showWhereIFarted(context, true)
  })

  await test.step('reports it', async () => {
    await other.getByRole('button', { name: 'Report' }).click()
    const dialog = other.getByRole('alertdialog')
    await expect(dialog.getByRole('heading', { name: 'Report this Toot?' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Report' }).click()
    await expect(other.getByText('Reported. Thanks.')).toBeVisible()
  })

  await test.step('an old random-id link, or one in capitals, answers a 308 to the named link, with its query (#441)', async () => {
    const [{ id }] = fromTheLocalDatabase<{ id: string }>(
      `SELECT s.id FROM shares s JOIN handles h ON h.user_id = s.user_id
       WHERE h.handle = '${handle}' AND s.kind = 'toots'`
    )
    const slug = link.split('/').at(-2) ?? ''
    expect(id).not.toBe(slug)
    const query = '?from=mail&tag=a&tag=b'
    for (const name of [id, slug.toUpperCase()]) {
      const old = `/@${handle}/t/${name}/`
      const redirect = await other.request.get(`${old}${query}`, { maxRedirects: 0 })
      expect(redirect.status()).toBe(308)
      const to = new URL(redirect.headers().location ?? '', baseURL)
      expect(to.pathname + to.search).toBe(`${link}${query}`)
      // A browser never keeps it: the name can go to the next thing shared by it.
      const redirectCache = redirect.headers()['cache-control'] ?? ''
      expect(redirectCache).toContain('private')
      expect(redirectCache).toContain('no-cache')

      expect((await other.request.get(`${old}audio/`)).status()).toBe(200)
      expect((await other.request.get(`${old}image/`)).status()).toBe(200)
    }

    await other.goto(`/@${handle}/t/${id}/${query}`)
    await expect(other).toHaveURL(new URL(`${link}${query}`, baseURL).href)
    await expect(other.getByRole('heading', { name: title })).toBeVisible()
  })

  await test.step('the owner shares a Recording too, and their page heads with the Toot, under a tab each (#346, #448)', async () => {
    // In a second tab, so the first stays on the Toot's screen for the steps after.
    const tab = await context.newPage()
    await tab.goto('/recordings/')
    await tab
      .getByTestId('recording-row')
      .first()
      .getByRole('button', { name: /^Share / })
      .click()
    const tabSheet = () => tab.evaluate(() => window.__shared.map(shared => shared.url ?? ''))
    await expect.poll(tabSheet).toHaveLength(1)
    const recordingLink = new URL((await tabSheet())[0]).pathname
    expect(recordingLink).toMatch(new RegExp(`^/@${handle}/r/recording-\\d+/$`))
    await tab.close()

    // Its row draws the Toot's own bars and note roll, fetched once it's on screen (#448).
    const drawn = other.waitForResponse(r => new URL(r.url()).pathname === `${link}row/`)
    // Its farts were made in Testville, and the owner shows where: still, no row says so.
    madeInTestville(handle)
    const response = await other.goto(`/@${handle}/`)
    expect(response?.status()).toBe(200)
    expect(await other.content()).not.toContain('Testville')
    // The Toot heads the page, and its tab opens first (#448).
    const hero = other.getByTestId('profile-hero')
    await expect(hero.getByRole('link', { name: title })).toHaveAttribute('href', link)
    const shareTab = (name: string) => other.getByRole('tab', { name })
    await expect(shareTab('Toots')).toHaveAttribute('aria-selected', 'true')
    const rows = other.getByTestId('profile-shared-item')
    await expect(rows).toHaveCount(1)
    await expect(rows.getByTestId('profile-shared-link')).toHaveAttribute('href', link)
    await expect(rows.getByTestId('profile-shared-link')).toHaveText(title)
    // Laid out as SoundCloud's track row: the Handle over its name, as its uploader, the day at
    // the right, its length on its waveform, and its note roll as its picture.
    await expect(rows.getByTestId('profile-shared-byline')).toHaveText(`@${handle}`)
    await expect(rows.getByTestId('profile-shared-date')).toHaveText('Today')
    await expect(rows.getByTestId('profile-shared-length')).toHaveText(/^\d+:\d\d$/)
    expect((await drawn).status()).toBe(200)
    await expect(rows.getByTestId('profile-shared-art').locator('rect').first()).toBeVisible()
    await shot(other, 'toot-profile')
    await computerShot(other, 'toot-profile')
    await expectComputerRows(other)
    expect(await sidewaysAt375(other)).toBe(0)

    await shareTab('Recordings').click()
    await expect(shareTab('Recordings')).toHaveAttribute('aria-selected', 'true')
    await expect(rows).toHaveCount(1)
    await expect(rows.getByTestId('profile-shared-link')).toHaveAttribute('href', recordingLink)
    await expect(rows.getByTestId('profile-shared-link')).toContainText('Recording ')
    await expect(rows.getByTestId('profile-shared-byline')).toHaveText(`@${handle}`)
    await expect(rows).not.toContainText('Testville')
    // Its length is its fart's, the figure its own page prints, not the take's with its silence.
    const rowLength = await rows.getByTestId('profile-shared-length').textContent()
    expect(rowLength).toMatch(/^\d+\.\d s$/)
    const own = await context.newPage()
    await own.goto(recordingLink)
    await expect(own.getByTestId('shared-length')).toHaveText(rowLength ?? '')
    await own.close()
    await shot(other, 'toot-profile-recordings')
    await computerShot(other, 'toot-profile-recordings')
    await expectComputerRows(other)
    await shareTab('Toots').click()
    await expect(rows.getByTestId('profile-shared-link')).toHaveAttribute('href', link)

    // Copy link, under the waveform, copies the Toot's own link and stays on the page.
    await other.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await rows.getByTestId('profile-copy-link').click()
    await expect(rows.getByTestId('profile-copy-said')).toHaveText('Link copied')
    const copied = await other.evaluate(() => navigator.clipboard.readText())
    expect(new URL(copied).pathname).toBe(link)
    expect(new URL(other.url()).pathname).toBe(`/@${handle}/`)

    // Nothing private: not the Toot's id nor its owner's email, in the HTML or its page data.
    const html = (await response?.text()) ?? ''
    expect(html).toContain(title)
    for (const secret of [tootId, email]) {
      expect(html).not.toContain(secret)
      expect(await other.content()).not.toContain(secret)
    }
  })

  await test.step('someone signed out plays the Toot from the banner, then from its row, as it was saved (#448)', async () => {
    const sounds = () => other.evaluate(() => window.__sounds)
    const rows = other.getByTestId('profile-shared-item')
    const heroPlay = other.getByTestId('profile-hero-play')
    const playhead = other.getByTestId('profile-banner').getByTestId('profile-banner-playhead')
    // The row's picture is the same roll, with a playhead of its own while it plays (#451).
    const rowPlayhead = rows
      .getByTestId('profile-shared-art')
      .getByTestId('profile-banner-playhead')
    await expect(playhead).toHaveCount(0)
    await expect(rowPlayhead).toHaveCount(0)

    // From its own link's audio, with the banner's playhead moving over its notes.
    const audio = other.waitForResponse(r => new URL(r.url()).pathname === `${link}audio/`)
    await heroPlay.click()
    expect((await audio).status()).toBe(200)
    await expect.poll(async () => (await sounds()).length).toBe(1)
    const [sound] = await sounds()
    expect(sound.duration).toBeGreaterThan(1)
    expect(sound.peak).toBeGreaterThan(0.05)
    await expect(heroPlay).toHaveAccessibleName(`Stop ${title}`)
    const at = async () => Number(await playhead.getAttribute('x'))
    const first = await at()
    await expect.poll(at).toBeGreaterThan(first)
    // The same Toot, so its row says it's playing too.
    await expect(rows.getByRole('button', { name: `Stop ${title}` })).toBeVisible()
    await shot(other, 'toot-profile-hero-playing')
    await heroPlay.click()
    await expect(heroPlay).toHaveAccessibleName(`Play ${title}`)
    await expect(playhead).toHaveCount(0)

    // It plays in place from its row too.
    await rows.getByRole('button', { name: `Play ${title}` }).click()
    await expect.poll(async () => (await sounds()).length).toBe(2)
    expect((await sounds())[1].duration).toBe(sound.duration)
    await expect(rows.getByRole('button', { name: `Stop ${title}` })).toBeVisible()
    await expect(heroPlay).toHaveAccessibleName(`Stop ${title}`)
    // Where it is shows at the waveform's bottom left while it plays, as on SoundCloud.
    await expect(rows.getByTestId('profile-shared-time')).toHaveText(/^0:0\d$/)
    const rowAt = async () => Number(await rowPlayhead.getAttribute('x'))
    const rowFirst = await rowAt()
    await expect.poll(rowAt).toBeGreaterThan(rowFirst)
    await shot(other, 'toot-profile-playing')
  })

  await test.step("the owner stops sharing from the Toot's screen, and the link is gone", async () => {
    await page.getByRole('button', { name: `Share ${title}` }).click()
    await page.getByRole('menuitem', { name: 'Stop sharing' }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog.getByRole('heading', { name: `Stop sharing ${title}?` })).toBeVisible()
    await shot(page, 'toot-stop-sharing')
    await dialog.getByRole('button', { name: 'Stop sharing' }).click()
    await expect(page.getByTestId('toot-subtitle')).toHaveText(title)
    await expectGone(other, link, imageOf(link))
    await shot(other, 'toot-link-gone')
    // Its page has no banner now. It still opens on Toots, which says it has none, and lists
    // only the Recording under its own tab.
    await other.goto(`/@${handle}/`)
    const toots = other.getByRole('tab', { name: 'Toots' })
    await expect(toots).toHaveAttribute('aria-selected', 'true')
    await expect(other.getByText('No Toots shared yet.')).toBeVisible()
    await expect(other.getByTestId('profile-banner')).toHaveCount(0)
    await shot(other, 'profile-no-toot')
    await computerShot(other, 'profile-no-toot')
    await other.getByRole('tab', { name: 'Recordings' }).click()
    await expect(other.getByTestId('profile-shared-item')).toHaveCount(1)
    await shot(other, 'profile-no-toot-recordings')
    await computerShot(other, 'profile-no-toot-recordings')
    await expectComputerRows(other)
    expect(await sidewaysAt375(other)).toBe(0)
    await expect(other.locator(`a[href="${link}"]`)).toHaveCount(0)
  })

  await test.step('shared again, the link is back, and gone once the Toot is deleted', async () => {
    const before = (await shareSheet()).length
    await page.getByRole('button', { name: `Share ${title}` }).click()
    await expect.poll(shareSheet).toHaveLength(before + 1)
    const again = new URL((await shareSheet())[before]).pathname
    expect(again).toBe(link)
    expect((await other.goto(again))?.status()).toBe(200)
    expect((await other.request.get(imageOf(again))).status()).toBe(200)

    await page.getByRole('button', { name: `More for ${title}` }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(
      dialog.getByText("Its link stops working too. This can't be undone.")
    ).toBeVisible()
    await dialog.getByRole('button', { name: 'Delete Toot' }).click()
    await expect(page).toHaveURL(/\/toots\/$/)
    await uploaded(page)
    await expectGone(other, again, imageOf(again))
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
    expect(new URL(shared.url ?? '').pathname).toBe(`/@${handle}/r/morning-toot/`)
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
