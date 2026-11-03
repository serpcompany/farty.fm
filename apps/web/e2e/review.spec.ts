import { accountLibrary, newEmail, signInByApi } from './account'
import { uploaded } from './database'
import { fartAndRecord, waitForOpenMicrophone, withFartingMicrophone } from './record'
import { expect, test } from './test'

const placedOnA3 = 57

withFartingMicrophone()

test('a take trimmed, moved to another note and named in its review keeps them', async ({
  page
}, testInfo) => {
  test.setTimeout(120_000)
  await page.goto('/profile/')
  await signInByApi(page, newEmail(testInfo, 'review'))

  await page.goto('/')
  await waitForOpenMicrophone(page)
  await fartAndRecord(page)
  const review = page.getByRole('dialog', { name: 'New Recording' })

  await expect(review.getByTestId('review-note')).toHaveText('G3', { timeout: 30_000 })
  await expect(review.getByTestId('review-caption')).toHaveText(
    'We heard G3. Tap a key to hear it and make it the note.'
  )
  const length = review.getByTestId('review-length')
  const handlesApart = async () => Number.parseFloat(await length.innerText())
  const found = await handlesApart()

  const end = review.getByRole('slider', { name: 'Where the fart ends' })
  for (let i = 0; i < 2; i++) await end.press('Shift+ArrowLeft')
  await expect.poll(handlesApart).toBeCloseTo(found - 0.2, 1)
  const trimmed = await handlesApart()

  await review.getByRole('button', { name: 'A3', exact: true }).click()
  await expect(review.getByTestId('review-note')).toHaveText('A3')
  await expect(review.getByTestId('review-caption')).toHaveText('Changed from G3. Back to G3')

  await expect(review.getByRole('textbox', { name: 'Name' })).toHaveValue('Recording 1')
  await review.getByRole('textbox', { name: 'Name' }).fill('Big One')

  await review.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('result-note')).toHaveText('A3')
  await page.getByRole('button', { name: 'Done' }).click()

  const row = page.getByTestId('recording-row')
  const shows = async () => {
    await expect(row).toHaveCount(1)
    await expect(
      page.getByRole('button', { name: /^Big One, \d+\.\d s, A3, placed by ear, trimmed$/ })
    ).toBeVisible()
    await expect(page.getByTestId('recording-note')).toHaveText('A3')
    await expect(row).toContainText('Placed by ear')
    await expect(row).toContainText('Trimmed')
    const shown = Number.parseFloat(await page.getByTestId('recording-length').innerText())
    expect(shown).toBeLessThanOrEqual(trimmed + 1e-9)
    expect(shown).toBeLessThan(found - 0.1)
  }
  await shows()
  await uploaded(page)
  await page.reload()
  await shows()

  await page.getByRole('button', { name: 'Edit Big One' }).click()
  const saved = page.getByRole('dialog', { name: 'Big One' })
  await expect(saved.getByTestId('review-note')).toHaveText('A3')
  await expect(saved.getByRole('textbox', { name: 'Name' })).toHaveValue('Big One')
  await expect(saved.getByTestId('review-length')).toHaveText(`${trimmed.toFixed(2)} s`)
  await saved.getByRole('button', { name: 'Cancel' }).click()
  await expect(saved).toBeHidden()

  const [recording] = (await accountLibrary(page)).recordings
  expect(recording).toMatchObject({ name: 'Big One', placedPitch: placedOnA3 })
  expect(recording?.trim).not.toBeNull()
})
