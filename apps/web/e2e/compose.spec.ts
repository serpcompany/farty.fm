import { songs } from '../src/test-support/songs.generated'
import { fartAndSave, withFartingMicrophone } from './record'
import { expectTappable, lockedSong, songsHeading, tab } from './screens'
import { recordTheLastTwoOfMarysFarts } from './songs'
import { countResumesInTaps, forgetResumesInTaps, resumesInTaps } from './sounds'
import { expect, test } from './test'

const songsTheFourFartsUnlock = 6

withFartingMicrophone()

test.beforeEach(async ({ page }) => {
  await page.addInitScript(countResumesInTaps)
})

test('saving farts unlocks Songs on Compose, and the Result says so', async ({ page }) => {
  test.setTimeout(120_000)

  await page.goto('/compose/')
  await expect(page.getByText('No Melodic Recordings yet')).toBeVisible()
  await expect(songsHeading(page, 'Locked', songs.length)).toBeVisible()
  await expect(page.getByRole('heading', { name: /^Unlocked/ })).toHaveCount(0)

  const mary = lockedSong(page, 'Mary Had a Little Lamb')
  await mary.click()
  const sheet = page.getByRole('dialog', { name: 'Mary Had a Little Lamb' })
  await expect(sheet.getByTestId('locked-song-needs')).toHaveText(
    'Record a fart with a clear note to start.'
  )
  await expect(sheet.getByTestId('pitch-strip')).toHaveAccessibleName('No notes collected yet')
  await expectTappable(sheet.getByRole('button', { name: 'Close' }))
  await sheet.getByRole('button', { name: 'Close' }).click()
  await expect(sheet).toBeHidden()

  await tab(page, 'Record').click()
  await fartAndSave(page, '095')
  await expect(page.getByTestId('result-note')).toHaveText('F2')
  await expect(page.getByTestId('pitch-strip')).toHaveAccessibleName('Notes collected: F. New: F')
  await expect(page.getByTestId('result-progress')).not.toContainText('You unlocked')
  await expect(page.getByRole('button', { name: 'Record another' })).toBeVisible()
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page).toHaveURL(/\/recordings\/$/)

  await tab(page, 'Compose').click()
  await expect(page.getByText('No Melodic Recordings yet')).toHaveCount(0)
  await expect(songsHeading(page, 'Locked', songs.length)).toBeVisible()
  const noteAndLength = '[A-G]♯?\\d \\(\\d\\.\\d s\\)'
  await mary.scrollIntoViewIfNeeded()
  await expect(mary).toHaveAccessibleName(
    new RegExp(
      `^Mary Had a Little Lamb\\s+1 of 4 notes covered\\s+Needs ${noteAndLength}, ${noteAndLength}, and 1 more\\s+Locked$`
    )
  )

  await mary.click()
  await expect(sheet.getByTestId('locked-song-needs')).toHaveText(
    new RegExp(`^Needs a fart near ${noteAndLength}, ${noteAndLength}, and ${noteAndLength}\\.$`)
  )
  await expect(sheet.getByTestId('pitch-strip')).toHaveAccessibleName(
    /^Notes collected: F\. Needed: /
  )
  await sheet.getByRole('button', { name: 'Record' }).click()
  await expect(sheet).toBeHidden()
  await expect(page.getByTestId('record-button')).toBeVisible()

  await fartAndSave(page, '017')
  await expect(page.getByTestId('result-progress')).not.toContainText('You unlocked')
  await page.getByRole('button', { name: 'Record another' }).click()
  await recordTheLastTwoOfMarysFarts(page)
  await expect(page.getByRole('button', { name: 'Record another' })).toHaveCount(0)
  await expectTappable(page.getByRole('button', { name: 'Done' }))
  await expectTappable(page.getByRole('button', { name: 'Try it' }))
  await forgetResumesInTaps(page)
  await page.getByRole('button', { name: 'Try it' }).click()
  expect(await resumesInTaps(page)).toBe(1)
  await expect(page).toHaveURL(/\/compose\/mary\/$/)
  await expect(page.getByRole('heading', { name: 'Mary Had a Little Lamb' })).toBeVisible()
  await expect(page.getByTestId('recording-used')).toHaveCount(4)

  await page.getByRole('link', { name: 'Back to Compose' }).click()
  await expect(page).toHaveURL(/\/compose\/$/)
  await page.reload()
  await expect(songsHeading(page, 'Unlocked', songsTheFourFartsUnlock)).toBeVisible()
  await expect(songsHeading(page, 'Locked', songs.length - songsTheFourFartsUnlock)).toBeVisible()
  const unlocked = page
    .getByTestId('unlocked-songs')
    .locator('[data-song="mary"]')
    .getByRole('link')
  await expect(unlocked).toHaveText('Mary Had a Little LambReady')
  await expectTappable(unlocked)
  await unlocked.click()
  await expect(page).toHaveURL(/\/compose\/mary\/$/)
  await page.getByRole('link', { name: 'Back to Compose' }).click()

  await tab(page, 'Recordings').click()
  await expect(page.getByTestId('recording-row')).toHaveCount(4)
  await tab(page, 'Compose').click()

  const search = page.getByRole('searchbox', { name: 'Search Songs' })
  await expectTappable(search)
  await expectTappable(page.getByRole('button', { name: 'Sort' }))
  await search.fill('LITTLE')
  await expect(page.getByTestId('song-row')).toHaveCount(2)
  await search.fill('zzz')
  await expect(page.getByText('No Results for “zzz”')).toBeVisible()
  await search.fill('')
  await page.getByRole('button', { name: 'Sort' }).click()
  await page.getByRole('menuitemradio', { name: 'A–Z' }).click()
  await expect(page.getByTestId('locked-songs').getByTestId('song-row').first()).toHaveAttribute(
    'data-song',
    'all-through-the-night'
  )
})

test.describe('a Song Catalog that does not load', () => {
  test.use({ serviceWorkers: 'block' })

  test.beforeEach(({ pageErrors }) => {
    pageErrors.expect('the server responded with a status of 500')
  })

  test('says so on Compose and Profile, and Try again loads it', async ({ page, context }) => {
    await context.route('**/catalog/**', route => route.fulfill({ status: 500, body: 'down' }))
    await page.goto('/compose/')
    await expect(page.getByText("Couldn't load the Songs.")).toBeVisible()
    await page.goto('/profile/')
    await expect(page.getByText("Couldn't load the Songs.")).toBeVisible()

    await context.unroute('**/catalog/**')
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByTestId('stat-songs')).toHaveText(`Songs unlocked0 of ${songs.length}`)
    await tab(page, 'Compose').click()
    await expect(songsHeading(page, 'Locked', songs.length)).toBeVisible()
  })

  test("says so in Song Creator when a Song's notes don't load, and Try again loads them", async ({
    page,
    context
  }) => {
    await context.route('**/catalog/notes/**', route =>
      route.fulfill({ status: 500, body: 'down' })
    )
    await page.goto('/compose/mary/')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Mary Had a Little Lamb' })
    ).toBeVisible()
    await expect(page.getByText("Couldn't load this Song.")).toBeVisible()

    await context.unroute('**/catalog/notes/**')
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByText('This Song is locked.')).toBeVisible()
  })
})
