import { newEmail, signInByApi } from './account'
import { uploaded } from './database'
import { deleteRecording, recordG3, recordG3ToRecordings, withFartingMicrophone } from './record'
import { expectTappable, onPhone, tab } from './screens'
import { expect, test } from './test'

withFartingMicrophone()
test.skip(({ viewport }) => !onPhone({ viewport }), 'A full account is checked at phone size')

test('a full account keeps a new Recording on this device and says so, without uploading it again, then uploads it once a delete makes room', async ({
  page,
  pageErrors
}, testInfo) => {
  test.setTimeout(180_000)
  pageErrors.expect('the server responded with a status of 409')
  await page.goto('/profile/')
  await signInByApi(page, newEmail(testInfo, 'full'))
  await recordG3ToRecordings(page)
  await uploaded(page)

  const refused: string[] = []
  await page.route('**/api/recordings/*/', async route => {
    if (route.request().method() !== 'PUT') return route.fallback()
    refused.push(route.request().url())
    await route.fulfill({ status: 409, json: { error: 'limit_reached' } })
  })
  await recordG3(page)
  await page.getByRole('button', { name: 'Done' }).click()
  const notice = page.getByText(
    'Your account is full, so 1 Recording is only on this device. Delete some older ones to make room.'
  )
  await expect(notice).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('account-full-recordings.png') })

  await tab(page, 'Profile').click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Your account is full' })
  await expect(dialog).toContainText(
    "1 fart on this device isn't in your account because it's full. Delete some older ones to make room, or sign out now and lose it."
  )
  const keep = dialog.getByRole('button', { name: 'Keep it' })
  for (const control of [keep, dialog.getByRole('button', { name: 'Sign out anyway' })]) {
    await expectTappable(control)
  }
  await page.screenshot({ path: testInfo.outputPath('account-full-sign-out.png') })
  await keep.click()
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('account-email')).toBeVisible()
  expect(refused).toHaveLength(1)

  await page.unrouteAll()
  await tab(page, 'Recordings').click()
  await deleteRecording(page, 1)
  await expect(notice).toBeHidden()
  await uploaded(page)
  const numbers = await page.evaluate(async () => {
    const library: { recordings: { number: number }[] } = await (
      await fetch('/api/library/')
    ).json()
    return library.recordings.map(recording => recording.number)
  })
  expect(numbers).toEqual([2])
})
