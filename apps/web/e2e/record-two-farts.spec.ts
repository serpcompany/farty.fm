import { recordAndSave, withFartingMicrophone } from './record'
import { forgetSounds, hearSounds, lastSound } from './sounds'
import { expect, test } from './test'

const longerThanTheFirstBurstSeconds = 1.5

withFartingMicrophone()

test('recording two farts keeps both, and replay plays the whole take', async ({ page }) => {
  await page.addInitScript(hearSounds)
  await recordAndSave(page, '084')
  await expect(page.getByTestId('result-note')).toHaveText('G♯3')
  await expect(page.getByText('We kept the first fart')).toHaveCount(0)
  await page.getByRole('button', { name: 'Done' }).click()

  await expect(page.getByTestId('recording-note')).toHaveText('G♯3')
  await expect(page.getByTestId('recording-row')).not.toContainText('First fart used')
  const row = page.getByRole('button', { name: /^Recording 1, \d+\.\d s, G♯3$/ })
  await expect(row).toBeVisible()
  const length = Number.parseFloat(await page.getByTestId('recording-length').innerText())
  expect(length).toBeGreaterThanOrEqual(longerThanTheFirstBurstSeconds)

  await forgetSounds(page)
  await row.click()
  const replay = await lastSound(page)
  const [, offset, duration] = replay.args
  expect(offset).toBeUndefined()
  expect(duration).toBeUndefined()
  expect(replay.duration).toBeGreaterThan(3)
})
