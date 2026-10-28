import { recordAndSave, withFartingMicrophone } from './record'
import { expect, test } from './test'

withFartingMicrophone()

test('recording two farts keeps the first and says so', async ({ page }) => {
  await recordAndSave(page, '084')
  await expect(page.getByTestId('result-note')).toHaveText('G♯3')
  await expect(page.getByText('We kept the first fart')).toBeVisible()
  await page.getByRole('button', { name: 'Done' }).click()

  await expect(page.getByTestId('recording-note')).toHaveText('G♯3')
  await expect(page.getByTestId('recording-row')).toContainText('First fart used')
  await expect(
    page.getByRole('button', { name: /^Recording 1, \d+\.\d s, G♯3, first fart used$/ })
  ).toBeVisible()
})
