import { expect, test } from '@playwright/test'
import { recordAndSave, withFakeMicrophone } from './record'

// Fixture 084 holds two farts: the golden analysis keeps the first, at G♯3 (-17 cents).
withFakeMicrophone('084__walter-odington__grim-fart__26216.wav')

test('recording two farts keeps the first and says so', async ({ page }) => {
  await recordAndSave(page, 3.5)
  await expect(page.getByTestId('result-note')).toHaveText('G♯3')
  await expect(page.getByText('We kept the first fart')).toBeVisible()
})
