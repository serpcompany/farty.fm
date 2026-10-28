import { recordAndSave, withFartingMicrophone } from './record'
import { expect, test } from './test'

withFartingMicrophone()

test('recording a Noise-like fart says it has no steady note', async ({ page }) => {
  await recordAndSave(page, '065')
  await expect(page.getByTestId('result-noise')).toBeVisible()
  await page.getByRole('button', { name: 'Done' }).click()

  await expect(page.getByTestId('recording-note')).toHaveText('noise-like')
  await expect(page.getByTestId('pitch-summary')).toHaveText(
    /^0 Melodic Recordings across 0 notes\s*1 Recording$/
  )
})
