import { recordAndSave, withFakeMicrophone } from './record'
import { expect, test } from './test'

withFakeMicrophone('084__walter-odington__grim-fart__26216.wav')

test('recording two farts keeps the first and says so', async ({ page }) => {
  await recordAndSave(page, 4)
  await expect(page.getByTestId('result-note')).toHaveText('G♯3')
  await expect(page.getByText('We kept the first fart')).toBeVisible()
  await page.getByRole('button', { name: 'Done' }).click()

  await expect(page.getByTestId('recording-note')).toHaveText('G♯3')
  await expect(page.getByTestId('recording-row')).toContainText('First fart used')
  await expect(
    page.getByRole('button', { name: /^Recording 1, \d+\.\d s, G♯3, first fart used$/ })
  ).toBeVisible()
})
