import { randomInt } from 'node:crypto'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { songIndex } from '../src/lib/catalog/song-index.generated'
import { songVersion } from '../src/lib/song-report'
import { ownClient } from './account'
import { songsTheFixtureLibraryUnlocks } from './golden'
import { skipWelcome } from './record'

// Report a problem with a Song (#358), as a guest: from a locked Song's sheet, and at the end of
// Song Creator, where a report that can't be sent keeps the reason and the note. Each report goes
// to the server as it is, and the server keeps it (204).
//
// Each test reports a Song picked at random, from its own client address (`ownClient`), so reruns
// against one local D1 stay under a Song's 5 reports a day and a reporter's 10 an hour.

const pick = <T>(list: readonly T[]): T => list[randomInt(list.length)]
const shipped = new Set(songIndex.map(song => song.id))

test.beforeEach(async ({ page, context }) => {
  await ownClient(context)
  await page.addInitScript(skipWelcome)
})

/** Finds `title` with Compose's search, as a person would among 1,000 Songs. */
async function search(page: Page, title: string) {
  await page.getByRole('searchbox', { name: 'Search Songs' }).fill(title)
}

/** The report sheet's form: Send waits for a reason, and the note keeps to 500 characters. */
async function fillIn(sheet: Locator, reason: string, note: string) {
  const send = sheet.getByRole('button', { name: 'Send' })
  await expect(send).toBeDisabled()
  // The whole row is the reason's label.
  await sheet.getByText(reason, { exact: true }).click()
  await expect(sheet.getByRole('radio', { name: reason })).toBeChecked()
  await expect(sheet.getByRole('radio', { checked: true })).toHaveCount(1)
  const field = sheet.getByLabel('Add a note (optional)')
  await expect(field).toHaveAttribute('maxlength', '500')
  await field.fill(note)
  await expect(sheet.getByText(`${note.length}/500`)).toBeVisible()
  await expect(send).toBeEnabled()
}

/** Taps Send and returns what it sent and how the server answered. */
async function send(page: Page, sheet: Locator, songId: string) {
  const isReport = (url: string) => new URL(url).pathname === `/api/songs/${songId}/report/`
  const [request, response] = await Promise.all([
    page.waitForRequest(request => isReport(request.url()) && request.method() === 'POST'),
    page.waitForResponse(response => isReport(response.url())),
    sheet.getByRole('button', { name: 'Send' }).click()
  ])
  return { body: request.postDataJSON(), status: response.status() }
}

/** The thank-you, with the Song's title; Done closes it. */
async function thanks(page: Page, title: string) {
  const done = page.getByRole('dialog', { name: "Thanks, we'll take a look." })
  await expect(done).toContainText(title)
  await done.getByRole('button', { name: 'Done' }).click()
  await expect(done).toBeHidden()
}

test("reports a locked Song from its sheet, and keeps nothing but what's sent", async ({
  page
}) => {
  const song = pick(songIndex)
  await page.goto('/compose/')
  await search(page, song.title)
  await page
    .getByTestId('locked-songs')
    .locator(`[data-song="${song.id}"]`)
    .getByRole('button', { name: song.title, exact: true })
    .click()
  const locked = page.getByRole('dialog', { name: song.title })
  await expect(locked.getByRole('button', { name: 'Record' })).toBeVisible()

  // Report a problem, under Record, closes the locked sheet and opens the report sheet.
  await locked.getByRole('button', { name: 'Report a problem' }).click()
  await expect(locked).toBeHidden()
  const sheet = page.getByRole('dialog', { name: 'Report a problem' })
  await expect(sheet).toContainText(song.title)
  await fillIn(sheet, 'Wrong title or composer', 'The composer is someone else')

  const sent = await send(page, sheet, song.id)
  expect(sent).toEqual({
    body: {
      reason: 'wrong_title',
      note: 'The composer is someone else',
      version: songVersion(song)
    },
    status: 204
  })
  await thanks(page, song.title)

  // Opened again, it's a new report.
  await page
    .getByTestId('locked-songs')
    .locator(`[data-song="${song.id}"]`)
    .getByRole('button', { name: song.title, exact: true })
    .click()
  await locked.getByRole('button', { name: 'Report a problem' }).click()
  await expect(sheet.getByRole('radio', { checked: true })).toHaveCount(0)
  await expect(sheet.getByLabel('Add a note (optional)')).toHaveValue('')
  await sheet.getByRole('button', { name: 'Close' }).click()
  await expect(sheet).toBeHidden()
})

test.describe('in Song Creator', () => {
  test.beforeEach(async ({ request }) => {
    // The Fixture Library, which unlocks Songs without recording, is only in the Staging build.
    const onStagingBuild =
      process.env.E2E_SERVER === 'preview' &&
      (await request.get('/fixtures/recordings/index.json')).ok()
    test.skip(!onStagingBuild, 'The Fixture Library is only in the Staging build')
  })

  test("reports the Song at its end, and keeps the reason and the note when it can't send", async ({
    page
  }) => {
    test.setTimeout(180_000)
    const song = pick(songsTheFixtureLibraryUnlocks.filter(s => shipped.has(s.id)))
    await page.goto('/profile/')
    const library = page.getByTestId('fixture-library')
    await library.getByRole('button', { name: 'Load the Fixture Library' }).click()
    await expect(library.getByRole('button', { name: 'Fixture Library loaded' })).toBeDisabled({
      timeout: 90_000
    })
    await page
      .getByRole('navigation', { name: 'Tabs' })
      .getByRole('link', { name: 'Compose', exact: true })
      .click()
    await search(page, song.title)
    await page
      .getByTestId('unlocked-songs')
      .locator(`[data-song="${song.id}"]`)
      .getByRole('link')
      .click()
    await expect(page).toHaveURL(new RegExp(`/compose/${song.id}/$`))
    await expect(page.getByTestId('song-creator-state')).toBeVisible({ timeout: 60_000 })

    // Report a problem, after the Recordings used.
    await page.getByRole('button', { name: 'Report a problem' }).click()
    const sheet = page.getByRole('dialog', { name: 'Report a problem' })
    await expect(sheet).toContainText(song.title)
    const note = 'The tune goes wrong in bar 3'
    await fillIn(sheet, 'Missing or wrong notes', note)

    // Too many reports: it says so and keeps what was picked and typed.
    await page.route('**/api/songs/*/report/', route =>
      route.fulfill({ status: 429, json: { error: 'too_many_reports' } })
    )
    await sheet.getByRole('button', { name: 'Send' }).click()
    await expect(sheet.getByRole('alert')).toHaveText(
      'Too many reports right now. Try again later.'
    )
    await expect(sheet.getByRole('radio', { name: 'Missing or wrong notes' })).toBeChecked()
    await expect(sheet.getByLabel('Add a note (optional)')).toHaveValue(note)
    await page.unroute('**/api/songs/*/report/')

    // Send again, and the server keeps it.
    const sent = await send(page, sheet, song.id)
    expect(sent).toEqual({
      body: { reason: 'wrong_notes', note, version: songVersion(song) },
      status: 204
    })
    await thanks(page, song.title)
    // Song Creator is as it was.
    await expect(page.getByTestId('song-creator-state')).toBeVisible()
  })
})
