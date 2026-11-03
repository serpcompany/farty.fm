import { expect, type Locator, type Page, test } from '@playwright/test'
import { searchKey } from '../src/lib/catalog/search-key'
import { songs } from '../src/lib/catalog/songs.generated'
import { songRows, sortRows } from '../src/lib/pitch-coverage'
import {
  fakeMicrophone,
  fartAndRecord,
  fixtureWavs,
  getUserMediaMs,
  waitForOpenMicrophone
} from './fake-microphone'
import { fixtureRecordings, songsUnlockedBy } from './golden'
import { skipWelcome } from './record'

// Compose and the Result screen, with Recordings made through the fake microphone in
// `fake-microphone.ts`, which plays each fart as the person presses Record, all on one page.
//
// Mary Had a Little Lamb unlocks with fixtures 095 (F2), 017 (D♯2), 022 (E2) and 002 (A♯2), with
// more Songs, and Hot Cross Buns unlocks before the fourth, at the third: the app's Pitch Coverage
// on the reference's analysis of these four (`golden.ts`), so the counts follow the catalog. Songs
// play each fart raw, at its own length (ADR 0012), so Mary's last note, 1.40 s long, needs 002
// (4.04 s with every burst, ADR 0016), the only one of the four that long (ADR 0011).
const journey = ['095', '017', '022', '002']
/** The Songs the journey's first `takes` takes unlock. */
const unlockedAt = (takes: number) => songsUnlockedBy(fixtureRecordings(journey.slice(0, takes)))

test.use({ permissions: ['microphone'] })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(fakeMicrophone, { wavs: fixtureWavs(), delayMs: getUserMediaMs })
  await page.addInitScript(skipWelcome)
})

function tab(page: Page, label: string) {
  return page
    .getByRole('navigation', { name: 'Tabs' })
    .getByRole('link', { name: label, exact: true })
}

/** Once Record's microphone is open, farts fixture `id` into it and saves the take. */
async function recordAndSave(page: Page, id: string) {
  await waitForOpenMicrophone(page)
  await fartAndRecord(page, id)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('result-note')).toBeVisible()
}

test('saving farts unlocks Songs on Compose, and the Result says so', async ({ page }) => {
  test.setTimeout(120_000)

  // Before any Recording, every Song is locked and Compose says how to start.
  await page.goto('/compose/')
  await expect(page.getByText('No Melodic Recordings yet')).toBeVisible()
  const locked = (count: number) =>
    page.getByRole('heading', { name: `Locked · ${count}`, exact: true })
  await expect(locked(songs.length)).toBeVisible()
  await expect(page.getByRole('heading', { name: /^Unlocked/ })).toHaveCount(0)

  // A locked Song's sheet: no Melodic Recordings yet.
  await page.getByRole('button', { name: 'Mary Had a Little Lamb', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: 'Mary Had a Little Lamb' })
  await expect(sheet.getByTestId('locked-song-needs')).toHaveText(
    'Record a fart with a clear note to start.'
  )
  await expect(sheet.getByTestId('pitch-strip')).toHaveAccessibleName('No notes collected yet')
  await expectTappable(sheet.getByRole('button', { name: 'Close' }))
  await sheet.getByRole('button', { name: 'Close' }).click()
  await expect(sheet).toBeHidden()

  // The first take: F2, collected on the Result's pitch strip. Nothing unlocks yet.
  await tab(page, 'Record').click()
  await recordAndSave(page, '095')
  await expect(page.getByTestId('result-note')).toHaveText('F2')
  await expect(page.getByTestId('pitch-strip')).toHaveAccessibleName('Notes collected: F. New: F')
  await expect(page.getByTestId('result-progress')).not.toContainText('You unlocked')
  await expect(page.getByRole('button', { name: 'Record another' })).toBeVisible()
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page).toHaveURL(/\/recordings\/$/)

  await tab(page, 'Compose').click()
  await expect(page.getByText('No Melodic Recordings yet')).toHaveCount(0)
  await expect(locked(songs.length)).toBeVisible()
  const mary = page.getByRole('button', { name: 'Mary Had a Little Lamb', exact: true })
  // Which notes it needs depends on the take's settle time (two Arrangements nearly tie), so the
  // journey checks the shape; `pitch-coverage.test.ts` pins the exact notes on the golden 095.
  // A row works out its notes once it's near the screen (#323).
  await mary.scrollIntoViewIfNeeded()
  await expect(mary).toHaveAccessibleDescription(
    /^Locked\. 1 of 4 notes covered\. Needs [A-G]♯?\d \(\d\.\d s\), [A-G]♯?\d \(\d\.\d s\), and 1 more$/
  )

  // The locked Song's sheet names the notes it needs, and how long a fart each needs (ADR 0011).
  // Record goes to the Record tab.
  await mary.click()
  await expect(sheet.getByTestId('locked-song-needs')).toHaveText(
    /^Needs a fart near [A-G]♯?\d \(\d\.\d s\), [A-G]♯?\d \(\d\.\d s\), and [A-G]♯?\d \(\d\.\d s\)\.$/
  )
  await expect(sheet.getByTestId('pitch-strip')).toHaveAccessibleName(
    /^Notes collected: F\. Needed: /
  )
  await sheet.getByRole('button', { name: 'Record' }).click()
  await expect(sheet).toBeHidden()
  await expect(page.getByTestId('record-button')).toBeVisible()

  // Three more takes: the third unlocks Hot Cross Buns, and the fourth Mary and more Songs.
  expect(unlockedAt(2)).toEqual([])
  const third = unlockedAt(3).map(s => s.title)
  expect(third).toContain('Hot Cross Buns')
  expect(third).not.toContain('Mary Had a Little Lamb')
  const fourth = unlockedAt(4).length - third.length
  expect(fourth).toBeGreaterThan(2)
  await recordAndSave(page, '017')
  await expect(page.getByTestId('result-progress')).not.toContainText('You unlocked')
  await page.getByRole('button', { name: 'Record another' }).click()
  await recordAndSave(page, '022')
  for (const title of third)
    await expect(page.getByTestId('result-progress')).toContainText(`You unlocked ${title}`)
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page).toHaveURL(/\/recordings\/$/)
  await tab(page, 'Record').click()
  await recordAndSave(page, '002')

  // More than 2 unlocks are counted, then listed in the catalog's order, where Mary comes first.
  await expect(page.getByTestId('result-progress')).toContainText(`You unlocked ${fourth} Songs`)
  await expect(page.getByTestId('result-progress')).toContainText('Mary Had a Little Lamb · ')
  // After an unlock, Try it opens the Song in Song Creator, and Done goes to Recordings.
  await expect(page.getByRole('button', { name: 'Record another' })).toHaveCount(0)
  await expectTappable(page.getByRole('button', { name: 'Done' }))
  await expectTappable(page.getByRole('button', { name: 'Try it' }))
  // Try it starts the sound while it handles the tap, as iPhone Safari needs, so Song Creator
  // plays the Toot by itself once it's made. A click reaches the window first while capturing
  // and last while bubbling, so the page's own handlers run in between.
  await page.evaluate(() => {
    const counted = window as unknown as { resumesInTaps: number }
    counted.resumesInTaps = 0
    let inTap = false
    addEventListener('click', () => (inTap = true), { capture: true })
    addEventListener('click', () => (inTap = false))
    const resume = AudioContext.prototype.resume
    AudioContext.prototype.resume = function (this: AudioContext) {
      if (inTap) counted.resumesInTaps += 1
      return resume.call(this)
    }
  })
  await page.getByRole('button', { name: 'Try it' }).click()
  expect(
    await page.evaluate(() => (window as unknown as { resumesInTaps: number }).resumesInTaps)
  ).toBe(1)
  await expect(page).toHaveURL(/\/compose\/mary\/$/)
  await expect(page.getByRole('heading', { name: 'Mary Had a Little Lamb' })).toBeVisible()
  await expect(page.getByTestId('recording-used')).toHaveCount(4)

  // Back returns to Compose, where the Unlocked Song opens Song Creator too.
  await page.getByRole('link', { name: 'Back to Compose' }).click()
  await expect(page).toHaveURL(/\/compose\/$/)
  // A reload continues a guest's visit (`visit.ts`), so from here Compose and Recordings read the
  // four Recordings back from storage.
  await page.reload()
  const unlockedSongs = unlockedAt(4).length
  await expect(
    page.getByRole('heading', { name: `Unlocked · ${unlockedSongs}`, exact: true })
  ).toBeVisible()
  await expect(locked(songs.length - unlockedSongs)).toBeVisible()
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

  // Search and sort.
  const search = page.getByRole('searchbox', { name: 'Search Songs' })
  await expectTappable(search)
  await expectTappable(page.getByRole('button', { name: 'Sort' }))
  // Every Song with "little" in its title or another name, worked out from the catalog.
  const little = songs.filter(song =>
    [song.title, ...(song.aliases ?? [])].some(name => searchKey(name).includes('little'))
  )
  expect(little.map(song => song.id)).toContain('mary')
  await search.fill('LITTLE')
  await expect(page.getByTestId('song-row')).toHaveCount(little.length)
  await search.fill('zzz')
  await expect(page.getByText('No Results for “zzz”')).toBeVisible()
  await search.fill('')
  await page.getByRole('button', { name: 'Sort' }).click()
  await page.getByRole('menuitemradio', { name: 'A–Z' }).click()
  // The first locked Song by the app's A–Z order, which puts a title that starts with a number
  // first.
  const firstLocked = sortRows(songRows(songs, fixtureRecordings(journey)), 'alphabetical').find(
    row => !row.coverage.unlocked
  )
  expect(firstLocked).toBeDefined()
  await expect(page.getByTestId('locked-songs').getByTestId('song-row').first()).toHaveAttribute(
    'data-song',
    firstLocked?.song.id ?? ''
  )
})

// The browser fetches the Song Catalog as data (#322). With no service worker to answer for it, a
// catalog the server won't give says so on Compose and Profile, and Try again loads it.
test.describe('a Song Catalog that does not load', () => {
  test.use({ serviceWorkers: 'block' })

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
    await expect(page.getByRole('heading', { name: `Locked · ${songs.length}` })).toBeVisible()
  })

  // A Song's notes load as it opens (#323): offline, a Song never opened has none.
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
    // No Recordings yet, so the Song it loaded is locked.
    await expect(page.getByText('This Song is locked.')).toBeVisible()
  })
})

/** A control a thumb can hit: at least 44 by 44 CSS pixels, as the iPhone's controls. */
async function expectTappable(control: Locator) {
  const box = await control.boundingBox()
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
}
