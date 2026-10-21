import { resolve } from 'node:path'
import { type BrowserContext, expect, type Locator, type Page, test } from '@playwright/test'
import { newEmail, signInByApi } from './account'
import { recordAndSave } from './record'

// Compose and the Result screen, with Recordings made through Chromium's fake microphone. A
// browser plays its fake microphone's file once, so each take is a new launch of the same profile,
// which keeps the Recordings in IndexedDB between takes.
//
// Mary Had a Little Lamb unlocks with fixtures 090 (G3), 084 and 086 (both G♯3) and 094 (B3): the
// reference's golden Arrangement for Mary with the whole Fixture Library. Each take records for
// about a second longer than its file.
const takes: [fixture: string, seconds: number][] = [
  ['090__carlosramon__17-pet__186119.wav', 1.5],
  ['084__walter-odington__grim-fart__26216.wav', 3.5],
  ['086__walter-odington__little-parp__26793.wav', 1.5],
  ['094__manicciola__fart__121783.wav', 5.75]
]

test.describe.configure({ mode: 'serial' })

function tab(page: Page, label: string) {
  return page
    .getByRole('navigation', { name: 'Tabs' })
    .getByRole('link', { name: label, exact: true })
}

test('saving farts unlocks Songs on Compose, and the Result says so', async ({
  playwright,
  headless,
  baseURL,
  httpCredentials,
  viewport,
  userAgent,
  deviceScaleFactor,
  isMobile,
  hasTouch
}, testInfo) => {
  test.setTimeout(180_000)
  const profile = testInfo.outputPath('profile')
  /** A browser on the same profile whose fake microphone plays `fixture`. */
  const launch = (fixture: string): Promise<BrowserContext> =>
    playwright.chromium.launchPersistentContext(profile, {
      headless,
      baseURL,
      httpCredentials,
      viewport,
      userAgent,
      deviceScaleFactor,
      isMobile,
      hasTouch,
      // A relaunched profile's service worker answers navigations itself, and its requests then
      // meet the Staging gate without the test's credentials.
      serviceWorkers: 'block',
      // No microphone permission up front, so the first tap opens the microphone and the file
      // plays from the tap (see `withFakeMicrophone`).
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-audio-capture=${resolve(__dirname, '../../../fixtures/recordings', fixture)}%noloop`
      ]
    })

  // Before any Recording, every Song is locked and Compose says how to start.
  let context = await launch(takes[0][0])
  let page = context.pages()[0] ?? (await context.newPage())
  await page.addInitScript(() => localStorage.setItem('pedos.welcomed', '1'))
  await page.goto('/compose/')
  // Signed in, so the Recordings outlast each relaunch: a guest's last only the visit.
  await signInByApi(page, newEmail(testInfo, 'compose'))
  await page.reload()
  await expect(page.getByText('No Melodic Recordings yet')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Locked · 12' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /^Unlocked/ })).toHaveCount(0)

  // A locked Song's sheet: no Melodic Recordings yet.
  await page.getByRole('button', { name: 'Mary Had a Little Lamb' }).click()
  const sheet = page.getByRole('dialog', { name: 'Mary Had a Little Lamb' })
  await expect(sheet.getByTestId('locked-song-needs')).toHaveText(
    'Record a fart with a clear note to start.'
  )
  await expect(sheet.getByTestId('pitch-strip')).toHaveAccessibleName('No notes collected yet')
  await expectTappable(sheet.getByRole('button', { name: 'Close' }))
  await sheet.getByRole('button', { name: 'Close' }).click()
  await expect(sheet).toBeHidden()

  // The first take: G3, collected on the Result's pitch strip. Nothing unlocks yet.
  await recordAndSave(page, takes[0][1])
  await expect(page.getByTestId('result-note')).toHaveText('G3')
  await expect(page.getByTestId('pitch-strip')).toHaveAccessibleName('Notes collected: G. New: G')
  await expect(page.getByTestId('result-progress')).not.toContainText('You unlocked')
  await expect(page.getByRole('button', { name: 'Record another' })).toBeVisible()
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page).toHaveURL(/\/recordings\/$/)

  await tab(page, 'Compose').click()
  await expect(page.getByText('No Melodic Recordings yet')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Locked · 12' })).toBeVisible()
  const mary = page.getByRole('button', { name: 'Mary Had a Little Lamb' })
  await expect(mary).toHaveAccessibleDescription(/^Locked\. 1 of 4 notes covered\. Needs /)

  // The locked Song's sheet names the notes it needs; Record goes to the Record tab.
  await mary.click()
  await expect(sheet.getByTestId('locked-song-needs')).toHaveText(/^Needs a fart near .+\.$/)
  await expect(sheet.getByTestId('pitch-strip')).toHaveAccessibleName(
    /^Notes collected: G\. Needed: /
  )
  await sheet.getByRole('button', { name: 'Record' }).click()
  await expect(sheet).toBeHidden()
  await expect(page.getByTestId('record-button')).toBeVisible()
  await context.close()

  // Three more takes; the fourth unlocks Mary.
  for (const [i, [fixture, seconds]] of takes.slice(1).entries()) {
    context = await launch(fixture)
    page = context.pages()[0] ?? (await context.newPage())
    await recordAndSave(page, seconds)
    await expect(page.getByTestId('result-note')).toBeVisible()
    if (i < 2) {
      await expect(page.getByTestId('result-progress')).not.toContainText('You unlocked')
      await context.close()
    }
  }

  await expect(page.getByTestId('result-progress')).toContainText(
    'You unlocked Mary Had a Little Lamb'
  )
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
  await expect(page.getByRole('heading', { name: 'Unlocked · 1' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Locked · 11' })).toBeVisible()
  const unlocked = page.getByTestId('unlocked-songs').getByRole('link')
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
  await search.fill('LITTLE')
  await expect(page.getByTestId('song-row')).toHaveCount(2)
  await search.fill('zzz')
  await expect(page.getByText('No Results for “zzz”')).toBeVisible()
  await search.fill('')
  await page.getByRole('button', { name: 'Sort' }).click()
  await page.getByRole('menuitemradio', { name: 'A–Z' }).click()
  await expect(page.getByTestId('locked-songs').getByTestId('song-row').first()).toHaveAttribute(
    'data-song',
    'amazing'
  )
  await context.close()
})

/** A control a thumb can hit: at least 44 by 44 CSS pixels, as the iPhone's controls. */
async function expectTappable(control: Locator) {
  const box = await control.boundingBox()
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
}
