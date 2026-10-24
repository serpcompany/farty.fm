import { expect, test } from '@playwright/test'
import { recordAndSave, withFakeMicrophone } from './record'

// Fixture 065 is Noise-like: the golden analysis finds no steady pitch.
withFakeMicrophone('065__reino93__fart-7__324626.wav')

test('recording a Noise-like fart says it has no steady note', async ({ page }) => {
  await recordAndSave(page, 2.5)
  await expect(page.getByTestId('result-noise')).toBeVisible()
  await page.getByRole('button', { name: 'Done' }).click()

  // On the Recordings tab it's noise-like, and it isn't a Melodic Recording.
  await expect(page.getByTestId('recording-note')).toHaveText('noise-like')
  await expect(page.getByTestId('pitch-summary')).toHaveText(
    /^0 Melodic Recordings across 0 notes\s*1 Recording$/
  )
})
