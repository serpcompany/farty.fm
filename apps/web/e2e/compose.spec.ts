import { fartAndSave, withFartingMicrophone } from './fake-microphone'
import { expectTappable, tab } from './screens'
import { countResumesInTaps, forgetResumesInTaps, resumesInTaps } from './sounds'
import { expect, test } from './test'

withFartingMicrophone()

test.beforeEach(async ({ page }) => {
  await page.addInitScript(countResumesInTaps)
})

test('saving farts unlocks Songs on Compose, and the Result says so', async ({ page }) => {
  test.setTimeout(120_000)

  await page.goto('/compose/')
  await expect(page.getByText('No Melodic Recordings yet')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Locked · 12' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /^Unlocked/ })).toHaveCount(0)

  await page.getByRole('button', { name: 'Mary Had a Little Lamb' }).click()
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
  await expect(page.getByRole('heading', { name: 'Locked · 12' })).toBeVisible()
  const mary = page.getByRole('button', { name: 'Mary Had a Little Lamb' })
  const noteAndLength = (seconds: string) => `[A-G]♯?2 \\(${seconds} s\\)`
  await expect(mary).toHaveAccessibleDescription(
    new RegExp(
      `^Locked\\. 1 of 4 notes covered\\. Needs ${noteAndLength('1\\.5')}, ${noteAndLength('0\\.7')}, and 1 more$`
    )
  )

  await mary.click()
  await expect(sheet.getByTestId('locked-song-needs')).toHaveText(
    new RegExp(
      `^Needs a fart near ${noteAndLength('1\\.5')}, ${noteAndLength('0\\.7')}, and ${noteAndLength('\\d\\.\\d')}\\.$`
    )
  )
  await expect(sheet.getByTestId('pitch-strip')).toHaveAccessibleName(
    /^Notes collected: F\. Needed: /
  )
  await sheet.getByRole('button', { name: 'Record' }).click()
  await expect(sheet).toBeHidden()
  await expect(page.getByTestId('record-button')).toBeVisible()

  for (const id of ['017', '022']) {
    await fartAndSave(page, id)
    await expect(page.getByTestId('result-progress')).not.toContainText('You unlocked')
    await page.getByRole('button', { name: 'Record another' }).click()
  }
  await fartAndSave(page, '002')

  await expect(page.getByTestId('result-progress')).toContainText(
    'You unlocked Mary Had a Little Lamb'
  )
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
