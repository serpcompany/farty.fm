import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { songs } from '../src/lib/catalog/songs.generated'
import { newEmail, onTheLocalDatabase, signInByApi } from './account'
import { payAtTheDevCheckout, payOnTheSheet } from './pay'
import { skipWelcome } from './record'

// Downloading a saved Toot (#408): an account with Full Access saves a Toot and downloads it from
// its row and its screen, and the file is the audio saved, byte for byte. A full refund ends
// Download, on a page that still offers it too, while the Toot stays and plays. Refunds come from
// Stripe's webhook, so the journey makes one in the local database.
//
// With E2E_EVIDENCE_DIR set, it also writes its screenshots and the file there, for the PR.

const twinkle = songs.find(song => song.id === 'twinkle')?.title ?? 'twinkle'

// A service worker would answer navigations itself, without the Staging gate's credentials.
test.use({ serviceWorkers: 'block' })

const evidence = process.env.E2E_EVIDENCE_DIR ? resolve(process.env.E2E_EVIDENCE_DIR) : null

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** Loads the Fixture Library, from Profile on the Staging build. */
async function loadTheFixtureLibrary(page: Page) {
  const library = page.getByTestId('fixture-library')
  await library.getByRole('button', { name: 'Load the Fixture Library' }).click()
  await expect(library.getByRole('button', { name: 'Fixture Library loaded' })).toBeDisabled({
    timeout: 90_000
  })
}

/** Waits until nothing is left to upload: the saved Toot has reached the account. */
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

/** Reads the Toot's WAV the phone keeps, from IndexedDB. */
async function kept(page: Page, id: string): Promise<Buffer> {
  const dataUrl = await page.evaluate(async id => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('pedos')
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    const wav = await new Promise<ArrayBuffer>((resolve, reject) => {
      const r = db.transaction('tootAudio').objectStore('tootAudio').get(id)
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
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

/** Rate, length and loudest sample of a 16-bit PCM WAV, as the PR reports them. */
function measure(wav: Buffer) {
  expect(wav.toString('latin1', 0, 4)).toBe('RIFF')
  expect(wav.toString('latin1', 8, 12)).toBe('WAVE')
  let at = 12
  let rate = 0
  let channels = 0
  let bits = 0
  while (at + 8 <= wav.length) {
    const id = wav.toString('latin1', at, at + 4)
    const size = wav.readUInt32LE(at + 4)
    if (id === 'fmt ') {
      channels = wav.readUInt16LE(at + 10)
      rate = wav.readUInt32LE(at + 12)
      bits = wav.readUInt16LE(at + 22)
    }
    if (id === 'data') {
      let peak = 0
      for (let i = at + 8; i + 1 < at + 8 + size; i += 2) {
        peak = Math.max(peak, Math.abs(wav.readInt16LE(i)))
      }
      return {
        rate,
        channels,
        bits,
        seconds: size / (rate * channels * (bits / 8)),
        peak: peak / 32768
      }
    }
    at += 8 + size + (size % 2)
  }
  throw new Error('No data chunk')
}

test('Full Access downloads a saved Toot, the audio saved, until a refund ends it', async ({
  context,
  request
}, testInfo) => {
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
  const shot = async (name: string) => {
    if (out) await page.screenshot({ path: join(out, `${name}.png`), animations: 'disabled' })
  }
  await context.addInitScript(skipWelcome)
  const page = await context.newPage()
  const email = newEmail(testInfo, 'toot-download')
  const more = () => page.getByRole('button', { name: `More for ${twinkle}` })
  const downloadItem = () => page.getByRole('menuitem', { name: 'Download', exact: true })
  let id = ''

  await test.step(`signs in, pays for Full Access and saves a Toot of ${twinkle}`, async () => {
    await page.goto('/profile/')
    await signInByApi(page, email)
    await page.goto('/profile/')
    await loadTheFixtureLibrary(page)
    await page.goto('/compose/twinkle/')
    await expect(page.getByTestId('song-creator-state')).toBeVisible({ timeout: 60_000 })
    await page.getByRole('button', { name: 'Save to Toots' }).click()
    await expect(page.getByTestId('full-access-sheet')).toBeVisible()
    await shot('full-access-sheet')
    await payOnTheSheet(page)
    await payAtTheDevCheckout(page)
    await uploaded(page)
  })

  await test.step("downloads it from its row's More: the file is the audio saved", async () => {
    await page.goto('/toots/')
    await more().click()
    await expect(downloadItem()).toBeVisible()
    await shot('toot-row-menu')
    const arriving = page.waitForEvent('download')
    await downloadItem().click()
    const download = await arriving
    expect(download.suggestedFilename()).toBe(`${twinkle}.wav`)
    const path = await download.path()
    const file = readFileSync(path)

    await page.getByTestId('toot-row').getByRole('link').click()
    await expect(page).toHaveURL(/\/toots\/toot\/\?id=/)
    id = new URL(page.url()).searchParams.get('id') ?? ''
    const onThePhone = await kept(page, id)
    const onTheServer = await page.request.get(`/api/toots/${id}/audio/`)
    expect(onTheServer.status()).toBe(200)
    expect(sha256(file)).toBe(sha256(onThePhone))
    expect(sha256(file)).toBe(sha256(await onTheServer.body()))

    const measured = measure(file)
    console.log(
      `Downloaded ${download.suggestedFilename()}: ${file.length} bytes, sha256 ${sha256(file)}`
    )
    console.log(`Downloaded file measures ${JSON.stringify(measured)}`)
    expect(measured.rate).toBeGreaterThan(0)
    expect(measured.seconds).toBeGreaterThan(1)
    expect(measured.peak).toBeGreaterThan(0.01)
    expect(measured.peak).toBeLessThanOrEqual(1)
    if (out) writeFileSync(join(out, 'downloaded.wav'), file)
  })

  await test.step("downloads it from its screen's More too", async () => {
    await more().click()
    await expect(downloadItem()).toBeVisible()
    await shot('toot-screen-menu')
    const arriving = page.waitForEvent('download')
    await downloadItem().click()
    const download = await arriving
    expect(download.suggestedFilename()).toBe(`${twinkle}.wav`)
    expect(sha256(readFileSync(await download.path()))).toBe(sha256(await kept(page, id)))
  })

  await test.step('a refund ends it on a page that still offers it, with a note', async () => {
    onTheLocalDatabase(
      `UPDATE full_access SET refunded_at = ${Date.now()} WHERE user_id = (SELECT id FROM user WHERE email = '${email}')`
    )
    await more().click()
    await expect(downloadItem()).toBeVisible()
    let downloads = 0
    page.on('download', () => downloads++)
    await downloadItem().click()
    await expect(page.getByText('Download needs Full Access.')).toBeVisible()
    await shot('download-after-refund')
    await more().click()
    await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeVisible()
    await expect(downloadItem()).toBeHidden()
    await page.keyboard.press('Escape')
    expect(downloads).toBe(0)
  })

  await test.step('the refunded account keeps the Toot and it still plays, with no Download', async () => {
    await page.goto('/toots/')
    await expect(page.getByTestId('toot-row')).toHaveCount(1)
    await more().click()
    await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeVisible()
    await expect(downloadItem()).toBeHidden()
    await shot('toot-row-menu-refunded')
    await page.keyboard.press('Escape')
    const audio = await page.request.get(`/api/toots/${id}/audio/`)
    expect(audio.status()).toBe(200)
    expect(sha256(await audio.body())).toBe(sha256(await kept(page, id)))
    const blocked = await page.request.get(`/api/toots/${id}/download/`)
    expect(blocked.status()).toBe(402)
  })
})
