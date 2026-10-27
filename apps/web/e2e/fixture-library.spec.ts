import { expect, test } from '@playwright/test'

// The Fixture Library loader on Profile, in the Staging build only (`pnpm build:staging` copies the
// fixtures and turns the loader on). Loading it unlocks 11 of the 12 Songs: Amazing Grace's 2.98 s
// note outlasts every fixture, even moved down an octave (ADR 0011).

test.beforeEach(async ({ request }) => {
  // `next dev` never shows the loader, even with fixtures left in public/ by a Staging build.
  const onStagingBuild =
    process.env.E2E_SERVER === 'preview' &&
    (await request.get('/fixtures/recordings/index.json')).ok()
  test.skip(
    !onStagingBuild,
    'The Fixture Library is only in the Staging build (pnpm build:staging)'
  )
})

test('says when the Fixture Library did not load, and lets you try again', async ({ page }) => {
  await page.route('**/fixtures/recordings/090.wav', route => route.abort())
  await page.addInitScript(() => localStorage.setItem('pedos.welcomed', '1'))
  await page.goto('/profile/')
  const library = page.getByTestId('fixture-library')
  await library.getByRole('button', { name: 'Load the Fixture Library' }).click()
  await expect(library.getByRole('alert')).toHaveText('The Fixture Library didn’t load. Try again.')
  await expect(library.getByRole('button', { name: 'Load the Fixture Library' })).toBeEnabled()
  await expect(library.getByTestId('fixture-library-count')).toHaveText('0 of 32')
})

test('loads the Fixture Library and unlocks every Song it is long enough for', async ({ page }) => {
  test.setTimeout(120_000)

  await page.addInitScript(() => localStorage.setItem('pedos.welcomed', '1'))
  await page.goto('/profile/')
  const library = page.getByTestId('fixture-library')
  await expect(library.getByTestId('fixture-library-count')).toHaveText('0 of 32')
  await library.getByRole('button', { name: 'Load the Fixture Library' }).click()
  await expect(library.getByRole('button', { name: 'Fixture Library loaded' })).toBeDisabled({
    timeout: 90_000
  })
  await expect(library.getByTestId('fixture-library-count')).toHaveText('32 of 32')

  await page
    .getByRole('navigation', { name: 'Tabs' })
    .getByRole('link', { name: 'Compose', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: 'Unlocked · 11' })).toBeVisible({
    timeout: 60_000
  })
  await expect(page.getByRole('heading', { name: 'Locked · 1', exact: true })).toBeVisible()
  const amazing = page.getByRole('button', { name: 'Amazing Grace' })
  await expect(amazing).toHaveAccessibleDescription(
    'Locked. 5 of 6 notes covered. Needs D♯3 (3.0 s)'
  )
  await amazing.click()
  await expect(page.getByTestId('locked-song-needs')).toHaveText('Needs a fart near D♯3 (3.0 s).')
})
