import { expect, type Locator, type Page, test } from '@playwright/test'
import {
  fakeMicrophone,
  fartAndRecord,
  fixtureWavs,
  getUserMediaMs,
  waitForOpenMicrophone
} from './fake-microphone'
import { skipWelcome } from './record'

// Compose and the Result screen, with Recordings made through the fake microphone in
// `fake-microphone.ts`, which plays each fart as the person presses Record, all on one page.
//
// Mary Had a Little Lamb unlocks with fixtures 090 (G3), 084 and 013 (both G♯3) and 094 (B3), and
// no Song unlocks before the fourth: the reference's `melody_fit()` on these four. 013 lasts long
// enough, moved down an octave, for Mary's half notes (ADR 0011); 086, 0.24 s, doesn't.

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
  await tab(page, 'Record').click()
  await recordAndSave(page, '090')
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
  await expect(mary).toHaveAccessibleDescription(
    'Locked. 1 of 4 notes covered. Needs C2 (1.5 s), D2 (0.7 s), and 1 more'
  )

  // The locked Song's sheet names the notes it needs, and how long a fart each needs (ADR 0011):
  // the reference's `melody_fit()` on 090 alone. Record goes to the Record tab.
  await mary.click()
  await expect(sheet.getByTestId('locked-song-needs')).toHaveText(
    'Needs a fart near C2 (1.5 s), D2 (0.7 s), and E2 (0.7 s).'
  )
  await expect(sheet.getByTestId('pitch-strip')).toHaveAccessibleName(
    /^Notes collected: G\. Needed: /
  )
  await sheet.getByRole('button', { name: 'Record' }).click()
  await expect(sheet).toBeHidden()
  await expect(page.getByTestId('record-button')).toBeVisible()

  // Three more takes; the fourth unlocks Mary.
  for (const id of ['084', '013']) {
    await recordAndSave(page, id)
    await expect(page.getByTestId('result-progress')).not.toContainText('You unlocked')
    await page.getByRole('button', { name: 'Record another' }).click()
  }
  await recordAndSave(page, '094')

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
  // A reload continues a guest's visit (`visit.ts`), so from here Compose and Recordings read the
  // four Recordings back from storage.
  await page.reload()
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
})

/** A control a thumb can hit: at least 44 by 44 CSS pixels, as the iPhone's controls. */
async function expectTappable(control: Locator) {
  const box = await control.boundingBox()
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
}
