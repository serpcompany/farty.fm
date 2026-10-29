import { recordAndSave, withFartingMicrophone } from './record'
import { expect, test } from './test'

withFartingMicrophone()

test('recording a Noise-like fart says it has no steady note', async ({ page }) => {
  await recordAndSave(page, '065')
  await expect(page.getByTestId('result-noise')).toBeVisible()
  await expect(
    page.getByText('On the Recordings tab you can place it on a note by ear')
  ).toBeVisible()
  await page.getByRole('button', { name: 'Done' }).click()

  await expect(page.getByTestId('recording-note')).toHaveText('noise-like')
  await expect(page.getByTestId('pitch-summary')).toHaveText(
    /^0 Melodic Recordings across 0 notes\s*1 Recording$/
  )
})

test('a Noise-like fart can be placed on a note by ear, moved, and taken off (ADR 0015)', async ({
  page
}) => {
  await recordAndSave(page, '065')
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

  const summary = /^1 Melodic Recording across 1 note\s*1 Recording$/
  await expect(page.getByTestId('recording-note')).toHaveText('E3')
  await expect(page.getByTestId('recording-row')).toContainText('Placed by ear')
  await expect(page.getByTestId('pitch-summary')).toHaveText(summary)
  await page.reload()
  await expect(page.getByTestId('recording-note')).toHaveText('E3')
  await expect(page.getByTestId('pitch-summary')).toHaveText(summary)

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
