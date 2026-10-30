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

test('a fart the current analysis found no note in offers no Re-scan (#282)', async ({ page }) => {
  await recordAndSave(page, 2.5)
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByTestId('recording-note')).toHaveText('noise-like')
  // Analysis is deterministic: a Re-scan could only find what this analysis found.
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

test('a Noise-like fart can be trimmed in the picker, and the row then plays just that part (ADR 0019)', async ({
  page
}) => {
  await recordAndSave(page, 2.5)
  await page.getByRole('button', { name: 'Done' }).click()
  const row = page.getByTestId('recording-row')
  const length = page.getByTestId('recording-length')
  const seconds = async () => Number.parseFloat(await length.innerText())
  const whole = await seconds()

  // The row's waveform scrubs: a drag shows the playhead, and letting go plays from there.
  const waveform = row.getByRole('slider', { name: 'Play Recording 1 from a spot' })
  const box = await waveform.boundingBox()
  if (!box) throw new Error('no waveform')
  await page.mouse.move(box.x + 10, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 })
  await expect(row.getByTestId('playhead')).toBeVisible()
  await page.mouse.up()
  const play = page.getByRole('button', { name: /^Recording 1, \d+\.\d s, noise-like$/ })
  await expect(play).toHaveAttribute('aria-pressed', 'true')
  await expect(play).toHaveAttribute('aria-pressed', 'false', { timeout: 10_000 })

  // In the picker, Trim shows handles; the end pulled in half a second keeps a shorter fart.
  await page.getByRole('button', { name: /is noise-like\. Place it on a note$/ }).click()
  const picker = page.getByTestId('place-by-ear')
  await picker.getByRole('button', { name: 'Trim' }).click()
  await expect(picker.getByRole('button', { name: 'Reset to the fart Farty found' })).toBeDisabled()
  const end = picker.getByRole('slider', { name: 'Where the fart ends' })
  for (let i = 0; i < 5; i++) await end.press('Shift+ArrowLeft')
  await expect(picker.getByTestId('trim-readout')).toHaveText(/^\d+\.\d\d s to \d+\.\d\d s$/)
  await picker.getByRole('button', { name: 'Save trim' }).click()
  await expect(picker).toBeHidden()

  await expect(row).toContainText('Trimmed')
  await expect(
    page.getByRole('button', { name: /^Recording 1, \d+\.\d s, noise-like, trimmed$/ })
  ).toBeVisible()
  await expect.poll(seconds).toBeLessThan(whole - 0.3)
  await page.reload()
  await expect(row).toContainText('Trimmed')

  // Reset, then Remove trim: the whole fart again.
  await page.getByRole('button', { name: /is noise-like\. Place it on a note$/ }).click()
  await picker.getByRole('button', { name: 'Trim' }).click()
  await picker.getByRole('button', { name: 'Reset to the fart Farty found' }).click()
  await picker.getByRole('button', { name: 'Remove trim' }).click()
  await expect(row).not.toContainText('Trimmed')
  await expect.poll(seconds).toBe(whole)
})
