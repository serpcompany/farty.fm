import { newEmail, signInByApi } from './account'
import { uploaded } from './database'
import { deleteRecording } from './record'
import { onPhone, tab } from './screens'
import { loadTheFixtureLibrary, needsTheFixtureLibrary } from './songs'
import { expect, test } from './test'

needsTheFixtureLibrary()

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pedos.welcomed', '1'))
})

test('says when the Fixture Library did not load, and lets you try again', async ({
  page,
  pageErrors
}) => {
  pageErrors.expect('Failed to load resource')
  await page.route('**/fixtures/recordings/090.wav', route => route.abort())
  await page.goto('/profile/')
  const library = page.getByTestId('fixture-library')
  await library.getByRole('button', { name: 'Load the Fixture Library' }).click()
  await expect(library.getByRole('alert')).toHaveText('The Fixture Library didn’t load. Try again.')
  await expect(library.getByRole('button', { name: 'Load the Fixture Library' })).toBeEnabled()
  await expect(library.getByTestId('fixture-library-count')).toHaveText('0 of 32')
})

test('loads the Fixture Library and unlocks every Song it is long enough for', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/profile/')
  const library = page.getByTestId('fixture-library')
  await expect(library.getByTestId('fixture-library-count')).toHaveText('0 of 32')
  await loadTheFixtureLibrary(page)
  await expect(library.getByTestId('fixture-library-count')).toHaveText('32 of 32')

  await tab(page, 'Recordings').click()
  const first = page
    .getByTestId('recording-row')
    .filter({ has: page.getByRole('button', { name: /^Recording 1,/ }) })
  await expect(first.getByTestId('recording-length')).toHaveText('1.7 s')

  await tab(page, 'Compose').click()
  await expect(page.getByRole('heading', { name: 'Unlocked · 8' })).toBeVisible({
    timeout: 60_000
  })
  await expect(page.getByRole('heading', { name: 'Locked · 4', exact: true })).toBeVisible()
  const amazing = page.getByRole('button', { name: 'Amazing Grace' })
  await expect(amazing).toHaveAccessibleName(
    'Amazing Grace 4 of 6 notes covered Needs D3 (1.2 s) and F3 (3.0 s) Locked'
  )
  await amazing.click()
  await expect(page.getByTestId('locked-song-needs')).toHaveText(
    'Needs a fart near D3 (1.2 s) and F3 (3.0 s).'
  )
})

test('a fixture deleted from the account loads again, and stays', async ({
  page,
  viewport
}, testInfo) => {
  test.skip(!onPhone({ viewport }), 'Phone only')
  test.setTimeout(240_000)
  await page.goto('/profile/')
  await signInByApi(page, newEmail(testInfo, 'fixture-again'))
  await page.reload()
  await loadTheFixtureLibrary(page)
  await uploaded(page)

  await tab(page, 'Recordings').click()
  await deleteRecording(page, 1)
  await uploaded(page)

  await tab(page, 'Profile').click()
  const library = page.getByTestId('fixture-library')
  await expect(library.getByTestId('fixture-library-count')).toHaveText('31 of 32')
  await loadTheFixtureLibrary(page)
  await uploaded(page)
  await page.reload()
  await expect(library.getByTestId('fixture-library-count')).toHaveText('32 of 32')
})
