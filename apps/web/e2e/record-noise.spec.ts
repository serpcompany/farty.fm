import { expect, test } from '@playwright/test'
import { recordAndSave, withFakeMicrophone } from './record'

// Fixture 065 is Noise-like: the golden analysis finds no steady pitch.
withFakeMicrophone('065__reino93__fart-7__324626.wav')

test('recording a Noise-like fart says it has no steady note', async ({ page }) => {
  await recordAndSave(page, 2.5)
  await expect(page.getByTestId('result-noise')).toBeVisible()
  await expect(
    page.getByText('On the Recordings tab you can place it on a note by ear')
  ).toBeVisible()
  await page.getByRole('button', { name: 'Done' }).click()

  // On the Recordings tab it's noise-like, and it isn't a Melodic Recording.
  await expect(page.getByTestId('recording-note')).toHaveText('noise-like')
  await expect(page.getByTestId('pitch-summary')).toHaveText(
    /^0 Melodic Recordings across 0 notes\s*1 Recording$/
  )
})

test('Re-scan, of one fart or all, says when it finds no new note (#282)', async ({ page }) => {
  await recordAndSave(page, 2.5)
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByTestId('recording-note')).toHaveText('noise-like')

  const status = page.getByTestId('rescan-status')
  await page.getByRole('button', { name: /^Re-scan Recording \d+$/ }).click()
  await expect(status).toHaveText('No new notes')
  await page.getByRole('button', { name: 'Re-scan all' }).click()
  await expect(status).toHaveText('No new notes')
  await expect(page.getByTestId('recording-note')).toHaveText('noise-like')

  // Placed by ear, it has a note, so there's nothing to re-scan.
  await page.getByRole('button', { name: /is noise-like\. Place it on a note$/ }).click()
  const picker = page.getByTestId('place-by-ear')
  await picker.getByRole('button', { name: 'E3', exact: true }).click()
  await picker.getByRole('button', { name: 'Place at E3' }).click()
  await expect(picker).toBeHidden()
  await expect(page.getByTestId('recording-note')).toHaveText('E3')
  await expect(page.getByRole('button', { name: /^Re-scan/ })).toHaveCount(0)
})

test('a Noise-like fart can be placed on a note by ear, moved, and taken off (ADR 0015)', async ({
  page
}) => {
  await recordAndSave(page, 2.5)
  await page.getByRole('button', { name: 'Done' }).click()

  await page.getByRole('button', { name: /is noise-like\. Place it on a note$/ }).click()
  const picker = page.getByTestId('place-by-ear')
  await expect(
    picker.getByRole('heading', { name: /^Place Recording \d+ on a note$/ })
  ).toBeVisible()
  await expect(picker.getByRole('button', { name: 'Tap a key to choose a note' })).toBeDisabled()
  await picker.getByRole('button', { name: 'E3', exact: true }).click()
  await picker.getByRole('button', { name: 'Place at E3' }).click()
  await expect(picker).toBeHidden()

  // It counts as a Melodic Recording on E3, and stays placed after a reload.
  const summary = /^1 Melodic Recording across 1 note\s*1 Recording$/
  await expect(page.getByTestId('recording-note')).toHaveText('E3')
  await expect(page.getByTestId('recording-row')).toContainText('Placed by ear')
  await expect(page.getByTestId('pitch-summary')).toHaveText(summary)
  await page.reload()
  await expect(page.getByTestId('recording-note')).toHaveText('E3')
  await expect(page.getByTestId('pitch-summary')).toHaveText(summary)

  // Moved an octave down, then taken off: noise-like again.
  await page.getByRole('button', { name: 'E3, placed by ear. Move it or take it off' }).click()
  await expect(picker.getByRole('button', { name: 'Placed at E3' })).toBeDisabled()
  await picker.getByRole('button', { name: 'Octave down' }).click()
  await picker.getByRole('button', { name: 'E2', exact: true }).click()
  await picker.getByRole('button', { name: 'Move to E2' }).click()
  await expect(page.getByTestId('recording-note')).toHaveText('E2')

  await page.getByRole('button', { name: 'E2, placed by ear. Move it or take it off' }).click()
  await picker.getByRole('button', { name: 'Take it off' }).click()
  await expect(page.getByTestId('recording-note')).toHaveText('noise-like')
  await expect(page.getByTestId('recording-row')).not.toContainText('Placed by ear')
  await expect(page.getByTestId('pitch-summary')).toHaveText(
    /^0 Melodic Recordings across 0 notes\s*1 Recording$/
  )
})
