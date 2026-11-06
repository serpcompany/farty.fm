import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import { newEmail, onTheLocalDatabase, signInByApi } from './account'
import { payOnTheSheet, payToSave } from './pay'
import { skipWelcome } from './record'

// A saved Toot's Download (#408), on the Staging build with the Fixture Library loaded. The file is
// the Toot's own WAV: each journey reads the downloaded bytes and matches them to the copy saved in
// this browser and the account's. Real iPhone Safari isn't here (Chromium has no Safari prompt):
// the PR's tap-through has it, in the iOS Simulator.

const TITLE = 'Mary Had a Little Lamb'
const FILE_NAME = `${TITLE}.wav`
/** The session read that decides whether an account could be read at all. */
const SESSION_READ = '**/api/auth/get-session*'

test.use({ serviceWorkers: 'block' })

test.beforeEach(async ({ request }) => {
  await needsTheFixtureLibrary(request)
})

test('with Full Access, a saved Toot downloads from its row and its screen, byte for byte', async ({
  page
}, testInfo) => {
  test.setTimeout(180_000)
  await aSavedToot(page, newEmail(testInfo, 'download'))
  const id = await theTootId(page)
  const saved = sha256(await tootWav(page, id))

  await test.step('from the row: a file named after the Toot, the same bytes as saved', async () => {
    await tab(page, 'Toots').click()
    await openMore(page)
    const item = page.getByRole('menuitem', { name: 'Download' })
    // Polled, as the menu scales up as it opens.
    await expect.poll(async () => (await item.boundingBox())?.height).toBeGreaterThanOrEqual(44)
    const download = page.waitForEvent('download')
    await item.click()
    const file = await download
    expect(file.suggestedFilename()).toBe(FILE_NAME)
    const path = testInfo.outputPath(FILE_NAME)
    await file.saveAs(path)
    const bytes = await readFile(path)
    expect(sha256(bytes)).toBe(saved)
    expectSavedWavFormat(bytes)
    await expect(page.getByText("Once it's downloaded, it's in your Downloads.")).toBeVisible()
  })

  await test.step('it matches the account’s copy too', async () => {
    const account = await page.evaluate(
      async ({ id, library }) => {
        const response = await fetch(`/api/toots/${id}/audio/`, {
          headers: { 'x-pedos-library': library }
        })
        const bytes = new Uint8Array(await response.arrayBuffer())
        return { status: response.status, bytes: Array.from(bytes) }
      },
      { id, library: await accountOf(page) }
    )
    expect(account.status).toBe(200)
    expect(sha256(Buffer.from(account.bytes))).toBe(saved)
  })

  await test.step('from the Toot’s screen', async () => {
    await page.getByTestId('toot-row').getByRole('link').first().click()
    await expect(page).toHaveURL(/\/toots\/toot\/\?id=/)
    await openMore(page)
    const download = page.waitForEvent('download')
    await page.getByRole('menuitem', { name: 'Download' }).click()
    const file = await download
    expect(file.suggestedFilename()).toBe(FILE_NAME)
    const path = testInfo.outputPath('from-the-screen.wav')
    await file.saveAs(path)
    expect(sha256(await readFile(path))).toBe(saved)
  })

  await test.step('with its audio still to come from the account, the account’s copy downloads', async () => {
    await leaveTootAudioInTheAccount(page, id)
    await page.goto('/toots/')
    await openMore(page)
    const download = page.waitForEvent('download')
    await page.getByRole('menuitem', { name: 'Download' }).click()
    const path = testInfo.outputPath('from-the-account.wav')
    await (await download).saveAs(path)
    expect(sha256(await readFile(path))).toBe(saved)
  })

  await test.step('with no connection, it says so, and offers nothing', async () => {
    await page.context().setOffline(true)
    await openMore(page)
    await page.getByRole('menuitem', { name: 'Download' }).click()
    await expect(page.getByText("Couldn't reach Farty.", { exact: false })).toBeVisible()
    await expect(page.getByTestId('full-access-sheet')).toBeHidden()
    await page.context().setOffline(false)
  })

  await test.step('with the account unreadable when it opened, the tap reads it again and carries on', async () => {
    const refused = page.waitForRequest(SESSION_READ)
    await page.route(SESSION_READ, route => route.abort())
    await page.goto('/toots/')
    await refused
    await expect(page.getByRole('button', { name: `More for ${TITLE}` })).toBeVisible()
    await page.unroute(SESSION_READ)
    await openMore(page)
    const download = page.waitForEvent('download')
    await page.getByRole('menuitem', { name: 'Download' }).click()
    const path = testInfo.outputPath('after-reading-the-account-again.wav')
    await (await download).saveAs(path)
    expect(sha256(await readFile(path))).toBe(saved)
  })
})

test('without Full Access, Download offers it, and paying comes back to a file on the Toot’s screen', async ({
  page
}, testInfo) => {
  test.setTimeout(180_000)
  const email = newEmail(testInfo, 'download-pay')
  await aSavedToot(page, email)
  const id = await theTootId(page)
  const saved = sha256(await tootWav(page, id))

  // As Stripe's `charge.refunded` webhook records it (`payments.workers.test.ts`).
  onTheLocalDatabase(
    `UPDATE full_access SET refunded_at = ${Date.now()} WHERE user_id = '${await accountOf(page)}'`
  )

  const noFile: string[] = []
  page.on('download', file => noFile.push(file.suggestedFilename()))
  const sheet = page.getByTestId('full-access-sheet')

  await test.step('the sheet says what it’s for, and Not now keeps everything as it was', async () => {
    await tab(page, 'Toots').click()
    await openMore(page)
    await page.getByRole('menuitem', { name: 'Download' }).click()
    await expect(sheet.getByRole('heading')).toHaveText('Keep every Toot you make.')
    await expect(sheet).toContainText('Download any saved Toot as a file')
    await expect(sheet).toContainText('Once, no subscription')
    await expect(sheet).toContainText(`Buying for ${email}.`)
    for (const name of ['Pay $4.99', 'Not now']) {
      await expect(sheet.getByRole('button', { name })).toBeInViewport({ ratio: 1 })
    }
    await sheet.getByRole('button', { name: 'Not now' }).click()
    await expect(sheet).toBeHidden()
    expect(noFile).toEqual([])
  })

  await test.step('cancelling at Checkout comes back to the Toot, and offers no file', async () => {
    await openMore(page)
    await page.getByRole('menuitem', { name: 'Download' }).click()
    await payOnTheSheet(page)
    await expect(page).toHaveURL(new RegExp(`/dev/checkout/\\?toot=${id}&return=toot$`))
    await page.getByRole('link', { name: 'Cancel' }).click()
    await expect(page).toHaveURL(new RegExp(`/toots/toot/\\?id=${id}$`))
    await expect(page.getByRole('alertdialog')).toBeHidden()
    expect(noFile).toEqual([])
  })

  await test.step('paying comes back to the Toot’s screen, and the file follows by itself', async () => {
    await openMore(page)
    await page.getByRole('menuitem', { name: 'Download' }).click()
    await payOnTheSheet(page)
    const download = page.waitForEvent('download', { timeout: 60_000 })
    await page.getByRole('button', { name: 'Pay $4.99' }).click()
    const file = await download
    expect(file.suggestedFilename()).toBe(FILE_NAME)
    const path = testInfo.outputPath('after-paying.wav')
    await file.saveAs(path)
    expect(sha256(await readFile(path))).toBe(saved)
    await expect(page.getByText("Once it's downloaded, it's in your Downloads.")).toBeVisible()
    await expect(page.getByRole('alertdialog')).toBeHidden()
    await expect(page).toHaveURL(new RegExp(`/toots/toot/\\?id=${id}$`))
  })

  await test.step('a reload is just the Toot’s screen', async () => {
    const before = noFile.length
    await page.reload()
    await expect(page.getByRole('button', { name: `More for ${TITLE}` })).toBeVisible()
    await expect(page.getByRole('alertdialog')).toBeHidden()
    expect(noFile).toHaveLength(before)
  })

  await test.step('back from paying with the account unreadable, the return waits for it', async () => {
    await page.route(SESSION_READ, route => route.abort())
    await page.goto(`/toots/toot/?id=${id}&checkout=done`)
    await expect(page.getByText("Couldn't reach Farty.", { exact: false })).toBeVisible()
    await expect(page).toHaveURL(/checkout=done/)
    await page.unroute(SESSION_READ)

    await openMore(page)
    const download = page.waitForEvent('download')
    await page.getByRole('menuitem', { name: 'Download' }).click()
    const path = testInfo.outputPath('after-the-account-came-back.wav')
    await (await download).saveAs(path)
    expect(sha256(await readFile(path))).toBe(saved)
    await expect(page).toHaveURL(new RegExp(`/toots/toot/\\?id=${id}$`))
  })
})

test.describe('a Home Screen app on iPhone', () => {
  test.use({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
  })

  test('goes through the share sheet with the very file, asking for a tap when it wants one', async ({
    page
  }, testInfo) => {
    test.setTimeout(180_000)
    await page.addInitScript(() => {
      const shares = window as unknown as {
        __shared: { name: string; type: string; sha256: string; fields: string[] }[]
        __refusals: number
      }
      shares.__shared = []
      shares.__refusals = 1
      Object.defineProperty(navigator, 'standalone', { value: true })
      navigator.canShare = () => true
      navigator.share = async data => {
        if (shares.__refusals-- > 0) throw new DOMException('no gesture', 'NotAllowedError')
        const file = data?.files?.[0]
        if (!file) throw new Error('Nothing to share')
        const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
        shares.__shared.push({
          name: file.name,
          type: file.type,
          sha256: Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join(''),
          fields: Object.keys(data ?? {})
        })
      }
    })
    await aSavedToot(page, newEmail(testInfo, 'download-home-screen'))
    const saved = sha256(await tootWav(page, await theTootId(page)))
    const noFile: string[] = []
    page.on('download', file => noFile.push(file.suggestedFilename()))

    await tab(page, 'Toots').click()
    await openMore(page)
    await page.getByRole('menuitem', { name: 'Download' }).click()

    const ready = page.getByRole('alertdialog')
    await expect(ready).toContainText('Your Toot is ready to download')
    await expect(ready.getByRole('button', { name: 'Download' })).toBeFocused()
    await ready.getByRole('button', { name: 'Download' }).click()
    await expect(ready).toBeHidden()

    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared))
      .toEqual([{ name: FILE_NAME, type: 'audio/wav', sha256: saved, fields: ['files'] }])
    expect(noFile).toEqual([])
  })
})

/** Signs in, loads the Fixture Library, and saves a Toot of Mary Had a Little Lamb, paying. */
async function aSavedToot(page: Page, email: string) {
  await page.addInitScript(skipWelcome)
  await page.goto('/profile/')
  await signInByApi(page, email)
  await page.reload()
  const library = page.getByTestId('fixture-library')
  await library.getByRole('button', { name: 'Load the Fixture Library' }).click()
  await expect(library.getByRole('button', { name: 'Fixture Library loaded' })).toBeDisabled({
    timeout: 90_000
  })
  await tab(page, 'Compose').click()
  await page
    .getByTestId('unlocked-songs')
    .locator('[data-song="mary"]')
    .getByRole('link')
    .click({ timeout: 60_000 })
  await expect(page.getByTestId('song-creator-state')).toHaveText('Playing', { timeout: 60_000 })
  await payToSave(page)
  // Uploaded, so the account has the Toot and its audio.
  await expect.poll(() => storedCount(page, 'outbox'), { timeout: 30_000 }).toBe(0)
}

async function needsTheFixtureLibrary(request: APIRequestContext) {
  test.skip(
    !(await request.get('/fixtures/recordings/index.json')).ok(),
    'Toots need the Fixture Library, which only the Staging build has (pnpm build:staging)'
  )
}

function tab(page: Page, label: string) {
  return page
    .getByRole('navigation', { name: 'Tabs' })
    .getByRole('link', { name: label, exact: true })
}

async function openMore(page: Page) {
  await page.getByRole('button', { name: `More for ${TITLE}` }).click()
}

function accountOf(page: Page): Promise<string> {
  return page.evaluate(() => localStorage.getItem('pedos.account') as string)
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** A Toot's WAV: 44.1 kHz, mono, 16-bit PCM, with its length matching its header. */
function expectSavedWavFormat(wav: Buffer) {
  expect(wav.subarray(0, 4).toString()).toBe('RIFF')
  expect(wav.subarray(8, 12).toString()).toBe('WAVE')
  expect(wav.readUInt16LE(20)).toBe(1)
  expect(wav.readUInt16LE(22)).toBe(1)
  expect(wav.readUInt32LE(24)).toBe(44_100)
  expect(wav.readUInt16LE(34)).toBe(16)
  expect(wav.readUInt32LE(40)).toBe(wav.length - 44)
}

function storedCount(page: Page, store: string): Promise<number> {
  return page.evaluate(async store => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('pedos')
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    const count = await new Promise<number>((resolve, reject) => {
      const r = db.transaction(store).objectStore(store).count()
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    db.close()
    return count
  }, store)
}

async function theTootId(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('pedos')
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const r = db.transaction('toots').objectStore('toots').getAllKeys()
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    db.close()
    return String(keys[0])
  })
}

/** A Toot's audio, read from IndexedDB. */
async function tootWav(page: Page, id: string): Promise<Buffer> {
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

/** Makes a saved Toot one this browser has from the account, whose WAV hasn't downloaded yet. */
async function leaveTootAudioInTheAccount(page: Page, id: string): Promise<void> {
  await page.evaluate(async id => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('pedos')
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['tootAudio', 'downloads'], 'readwrite')
      tx.objectStore('tootAudio').delete(id)
      tx.objectStore('downloads').put({ kind: 'toots', id }, `toots:${id}`)
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  }, id)
}
