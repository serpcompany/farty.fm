import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import { newEmail, onTheLocalDatabase, signInByApi } from './account'
import { payOnTheSheet, payToSave } from './pay'
import { skipWelcome } from './record'

// Someone who has just paid is never offered Pay again, however slowly the payment confirms (#433):
// back from Checkout at Save or Download, gone from the page, and tapping again. The dev checkout
// takes a payment at once, so each journey holds the server's answer at no, as it stays until the
// payment's word gets through, and watches every frame for the sheet. On a phone: nothing here
// depends on the screen.

test.use({ serviceWorkers: 'block' })

const NOTE_KEY = 'pedos.fullAccess.paymentPending'
const SESSION_READ = '**/api/auth/get-session*'

/** Whether this test's page has shown the Full Access sheet since it was last set to false. */
let sheetSeen = false

test.beforeEach(async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'The same sheet and wait on every screen')
  await needsTheFixtureLibrary(request)
  sheetSeen = false
  await page.exposeFunction('sawTheSheet', () => {
    sheetSeen = true
  })
  await page.addInitScript(() => {
    const report = (window as unknown as { sawTheSheet: () => void }).sawTheSheet
    const look = () => {
      if (document.querySelector('[data-testid="full-access-sheet"]')) report()
      requestAnimationFrame(look)
    }
    requestAnimationFrame(look)
  })
  await page.addInitScript(skipWelcome)
})

const sheet = (page: Page) => page.getByTestId('full-access-sheet')
const saveButton = (page: Page) => page.getByRole('button', { name: 'Save to Toots' })
const savedButton = (page: Page) => page.getByRole('button', { name: 'Saved to Toots' })

async function expectNoPayOffered(page: Page) {
  expect(
    sheetSeen || (await sheet(page).isVisible()),
    'Pay was offered to someone who just paid'
  ).toBe(false)
}

/** From here the account says no, until `through` is set, as the payment's word gets through. */
async function holdThePayment(page: Page): Promise<{ through: boolean }> {
  const slow = { through: false }
  await page.route(
    url => url.pathname === '/api/full-access/',
    route =>
      slow.through
        ? route.fallback()
        : route.fulfill({ json: { active: false, limitReached: false } })
  )
  return slow
}

/** The sheet is open: its Pay, the dev checkout's Pay, and back to an address saying it's paid. */
async function payAndComeBack(page: Page, back: RegExp) {
  await payOnTheSheet(page)
  await expect(page).toHaveURL(/\/dev\/checkout\//)
  await page.getByRole('button', { name: 'Pay $4.99' }).click()
  await expect(page).toHaveURL(back)
  sheetSeen = false
}

/** A tap on Save with the payment still on its way: it waits, says so, and offers nothing. */
async function saveWaitsOnThePayment(page: Page) {
  await saveButton(page).click()
  await expect(page.getByText('Tap Save to check again.').or(sheet(page))).toBeVisible({
    timeout: 60_000
  })
  await expectNoPayOffered(page)
}

/** The payment is through: Save saves, with nothing to pay, and the note of it is gone. */
async function saveOnceThrough(page: Page, slow: { through: boolean }) {
  slow.through = true
  await saveButton(page).click()
  await expect(savedButton(page)).toBeDisabled({ timeout: 60_000 })
  await expectNoPayOffered(page)
  expect(await page.evaluate(key => localStorage.getItem(key), NOTE_KEY)).toBe(null)
}

test('at Save, back from paying and gone from the page, Save waits and never offers Pay', async ({
  page
}, testInfo) => {
  test.setTimeout(240_000)
  await aSong(page, newEmail(testInfo, 'slow-save'))
  const slow = await holdThePayment(page)
  await saveButton(page).click()
  await payAndComeBack(page, /\/compose\/mary\/\?toot=[\w-]+&checkout=done$/)
  await expect(page.getByText('Confirming payment…')).toBeVisible({ timeout: 60_000 })

  // Gone from the page, by a whole new load, with no return on the address.
  await page.goto('/compose/mary/')
  await expect(saveButton(page)).toBeEnabled({ timeout: 60_000 })

  await saveWaitsOnThePayment(page)
  await saveOnceThrough(page, slow)
})

test('at Save, gone by a tab before the account is even read, another Song’s Save never offers Pay', async ({
  page
}, testInfo) => {
  test.setTimeout(240_000)
  await aSong(page, newEmail(testInfo, 'slow-save-tab'))
  const slow = await holdThePayment(page)
  await saveButton(page).click()

  // The return's first read of the account doesn't answer until they've left. That read starting says
  // the page is live, so the tab is a tap within the app and not a whole new load.
  let reached = () => {}
  const asked = new Promise<void>(resolve => {
    reached = resolve
  })
  let answer = () => {}
  const left = new Promise<void>(resolve => {
    answer = resolve
  })
  await page.route(SESSION_READ, async route => {
    if (page.url().includes('checkout=done')) reached()
    await left
    await route.fallback()
  })
  await payAndComeBack(page, /\/compose\/mary\/\?toot=[\w-]+&checkout=done$/)
  await asked
  await tab(page, 'Compose').click()
  await expect(page).toHaveURL(/\/compose\/$/)
  answer()

  await openSong(page, 'twinkle')
  await expect(saveButton(page)).toBeEnabled({ timeout: 60_000 })
  await saveWaitsOnThePayment(page)
  await saveOnceThrough(page, slow)
})

test('at the Sound Pad’s Save, back from paying and gone from the page, Save waits and never offers Pay', async ({
  page
}, testInfo) => {
  test.setTimeout(240_000)
  await aLibrary(page, newEmail(testInfo, 'slow-pad'))
  await page.goto('/compose/pad/')
  const pad = page.getByTestId('pad').first()
  await expect(pad).toHaveAttribute('data-ready', 'true', { timeout: 60_000 })
  await page.getByTestId('pad-take-record').tap()
  await pad.tap()
  await page.getByTestId('pad-take-stop').tap()
  await expect(saveButton(page)).toBeEnabled({ timeout: 60_000 })

  const slow = await holdThePayment(page)
  await saveButton(page).click()
  await payAndComeBack(page, /\/compose\/pad\/\?toot=[\w-]+&checkout=done$/)
  await expect(page.getByText('Confirming payment…')).toBeVisible({ timeout: 60_000 })

  // Gone from the page: the Sound Pad shows the kept take again.
  await page.goto('/compose/pad/')
  await expect(saveButton(page)).toBeEnabled({ timeout: 60_000 })

  await saveWaitsOnThePayment(page)
  await saveOnceThrough(page, slow)
})

test('at Download, back from paying and gone from the page, Download waits and never offers Pay', async ({
  page
}, testInfo) => {
  test.setTimeout(300_000)
  await aSong(page, newEmail(testInfo, 'slow-download'))
  await payToSave(page)
  // Uploaded, so the refund doesn't refuse it, and the Toot stays in the account.
  await expect.poll(() => outboxCount(page), { timeout: 30_000 }).toBe(0)
  // As Stripe's `charge.refunded` webhook records it (`payments.workers.test.ts`).
  const account = await page.evaluate(() => localStorage.getItem('pedos.account'))
  onTheLocalDatabase(
    `UPDATE full_access SET refunded_at = ${Date.now()} WHERE user_id = '${account}'`
  )

  const files: string[] = []
  page.on('download', file => files.push(file.suggestedFilename()))
  const download = async () => {
    await page.getByRole('button', { name: 'More for Mary Had a Little Lamb' }).click()
    await page.getByRole('menuitem', { name: 'Download' }).click()
  }

  const slow = await holdThePayment(page)
  await tab(page, 'Toots').click()
  await download()
  await expect(sheet(page)).toBeVisible()
  await payAndComeBack(page, /\/toots\/toot\/\?id=[\w-]+&checkout=done$/)
  await expect(page.getByText('Confirming payment…')).toBeVisible({ timeout: 60_000 })

  // Gone from the page: the Toots tab, by a whole new load, with no return on the address.
  await page.goto('/toots/')
  await download()
  await expect(page.getByText('Tap Download to check again.').or(sheet(page))).toBeVisible({
    timeout: 60_000
  })
  await expectNoPayOffered(page)
  expect(files).toEqual([])

  slow.through = true
  const file = page.waitForEvent('download', { timeout: 60_000 })
  await download()
  expect((await file).suggestedFilename()).toBe('Mary Had a Little Lamb.wav')
  await expectNoPayOffered(page)
  expect(await page.evaluate(key => localStorage.getItem(key), NOTE_KEY)).toBe(null)
})

test('a Checkout cancelled at Save leaves nothing waiting: Save offers Pay again', async ({
  page
}, testInfo) => {
  test.setTimeout(180_000)
  await aSong(page, newEmail(testInfo, 'slow-cancel'))
  await saveButton(page).click()
  await payOnTheSheet(page)
  await expect(page).toHaveURL(/\/dev\/checkout\//)
  await page.getByRole('link', { name: 'Cancel' }).click()
  await expect(page).toHaveURL(/\/compose\/mary\/$/)
  await expect(saveButton(page)).toBeEnabled({ timeout: 60_000 })
  expect(await page.evaluate(key => localStorage.getItem(key), NOTE_KEY)).toBe(null)

  await saveButton(page).click()
  await expect(sheet(page)).toBeVisible()
})

async function needsTheFixtureLibrary(request: APIRequestContext) {
  test.skip(
    !(await request.get('/fixtures/recordings/index.json')).ok(),
    'These need the Fixture Library, which only the Staging build has (pnpm build:staging)'
  )
}

/** Signs in and loads the Fixture Library. */
async function aLibrary(page: Page, email: string) {
  await page.goto('/profile/')
  await signInByApi(page, email)
  await page.reload()
  const library = page.getByTestId('fixture-library')
  await library.getByRole('button', { name: 'Load the Fixture Library' }).click()
  await expect(library.getByRole('button', { name: 'Fixture Library loaded' })).toBeDisabled({
    timeout: 90_000
  })
}

/** Signs in, loads the Fixture Library and opens a made Toot of Mary Had a Little Lamb. */
async function aSong(page: Page, email: string) {
  await aLibrary(page, email)
  await tab(page, 'Compose').click()
  await openSong(page, 'mary')
  await expect(saveButton(page)).toBeEnabled({ timeout: 60_000 })
}

async function openSong(page: Page, song: string) {
  await page
    .getByTestId('unlocked-songs')
    .locator(`[data-song="${song}"]`)
    .getByRole('link')
    .click({ timeout: 60_000 })
}

function tab(page: Page, label: string) {
  return page
    .getByRole('navigation', { name: 'Tabs' })
    .getByRole('link', { name: label, exact: true })
}

function outboxCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('pedos')
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    const count = await new Promise<number>((resolve, reject) => {
      const r = db.transaction('outbox').objectStore('outbox').count()
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    db.close()
    return count
  })
}
