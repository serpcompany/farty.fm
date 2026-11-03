import { randomInt } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { type BrowserContext, expect, type Page, test } from '@playwright/test'
import { songs } from '../src/lib/catalog/songs.generated'
import { codeFor, newEmail, ownClient, signInByApi } from './account'
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
    // Signed out, Get Farty starts Get Farty here (#318), so it's a button, not a link to `/`.
    await expect(other.getByRole('button', { name: 'Get Farty' }).first()).toBeVisible()
    await expect(other.getByRole('link', { name: 'Get Farty' })).toHaveCount(0)
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
    await gone(link)
  })

  await test.step('a link nobody shared is gone too', async () => {
    await gone(`/u/${handle}/r/000000000000/`)
  })

  await test.step('shared again, the new link is gone once the Recording is deleted', async () => {
    await page.getByRole('button', { name: 'Share Recording 1' }).click()
    // This page's own share sheet, since it loaded /recordings/: the new link only.
    await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(1)
    const again = new URL((await page.evaluate(() => window.__shared[0].url)) ?? '').pathname
    expect(again).toMatch(new RegExp(`^/u/${handle}/r/[0-9a-z]{12}/$`))
    expect(again).not.toBe(link)
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
  const out = evidence && join(evidence, testInfo.project.name)
  if (out) mkdirSync(out, { recursive: true })
  const shot = async (on: Page, name: string) => {
    // Menus and dialogs fade in: each is shot as it ends up.
    if (out) await on.screenshot({ path: join(out, `${name}.png`), animations: 'disabled' })
  }
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
    expect(link).toMatch(new RegExp(`^/u/${handle}/t/[0-9a-z]{12}/$`))
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
    await expect(other.getByTestId('shared-song')).toHaveText(twinkle)
    await expect(other.getByRole('navigation', { name: 'Tabs' })).toHaveCount(0)
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
    await expect(meta('og:description')).toHaveAttribute(
      'content',
      `${twinkle}, played on farts. Tap to play.`
    )
    await expect(meta('twitter:card')).toHaveAttribute('content', 'summary_large_image')
    const image = new URL((await meta('og:image').getAttribute('content')) ?? '')
    imagePath = image.pathname + image.search
    expect(imagePath).toContain(link)
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

  await test.step('reports it', async () => {
    await other.getByRole('button', { name: 'Report' }).click()
    const dialog = other.getByRole('alertdialog')
    await expect(dialog.getByRole('heading', { name: 'Report this Toot?' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Report' }).click()
    await expect(other.getByText('Reported. Thanks.')).toBeVisible()
  })

  await test.step('the owner shares a Recording too, and their page lists both, newest first, and plays the Toot (#346)', async () => {
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
    expect(recordingLink).toMatch(new RegExp(`^/u/${handle}/r/[0-9a-z]{12}/$`))
    await tab.close()

    const response = await other.goto(`/u/${handle}/`)
    expect(response?.status()).toBe(200)
    const rows = other.getByTestId('profile-shared-item')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0).getByRole('link')).toHaveAttribute('href', recordingLink)
    await expect(rows.nth(0).getByRole('link')).toContainText('Recording ·')
    const toot = rows.nth(1).getByRole('link')
    await expect(toot).toHaveAttribute('href', link)
    await expect(toot).toContainText(title)
    await expect(toot).toContainText(`Toot · ${twinkle} · Today`)
    await shot(other, 'toot-profile')

    // Nothing private: not the Toot's id nor its owner's email, in the HTML or its page data.
    const html = (await response?.text()) ?? ''
    expect(html).toContain(title)
    for (const secret of [tootId, email]) {
      expect(html).not.toContain(secret)
      expect(await other.content()).not.toContain(secret)
    }

    // It plays in place, from its own link's audio: the Toot as it was saved.
    const audio = other.waitForResponse(r => new URL(r.url()).pathname === `${link}audio/`)
    await rows
      .nth(1)
      .getByRole('button', { name: `Play ${title}` })
      .click()
    expect((await audio).status()).toBe(200)
    await expect.poll(() => other.evaluate(() => window.__sounds.length)).toBe(1)
    const sound = await other.evaluate(() => window.__sounds[0])
    expect(sound.duration).toBeGreaterThan(1)
    expect(sound.peak).toBeGreaterThan(0.05)
    await expect(rows.nth(1).getByRole('button', { name: `Stop ${title}` })).toBeVisible()
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
    // Its page lists only the Recording now.
    await other.goto(`/u/${handle}/`)
    await expect(other.getByTestId('profile-shared-item')).toHaveCount(1)
    await expect(other.locator(`a[href="${link}"]`)).toHaveCount(0)
  })

  await test.step('shared again, the new link is gone once the Toot is deleted', async () => {
    const before = (await shareSheet()).length
    await page.getByRole('button', { name: `Share ${title}` }).click()
    await expect.poll(shareSheet).toHaveLength(before + 1)
    const again = new URL((await shareSheet())[before]).pathname
    expect(again).toMatch(new RegExp(`^/u/${handle}/t/[0-9a-z]{12}/$`))
    expect(again).not.toBe(link)
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
