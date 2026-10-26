import { expect, test } from '@playwright/test'

// The Fixture Library loader on Profile, in the Staging build only (`pnpm build:staging` copies the
// fixtures and turns the loader on). Loading it gives the iPhone app's count: all 12 Songs unlocked.

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
  await expect(library.getByTestId('fixture-library-count')).toHaveText('0 of 22')
})

test('loads the Fixture Library and unlocks every Song', async ({ page }) => {
  test.setTimeout(120_000)

  await page.addInitScript(() => localStorage.setItem('pedos.welcomed', '1'))
  await page.goto('/profile/')
  const library = page.getByTestId('fixture-library')
  await expect(library.getByTestId('fixture-library-count')).toHaveText('0 of 22')
  await library.getByRole('button', { name: 'Load the Fixture Library' }).click()
  await expect(library.getByRole('button', { name: 'Fixture Library loaded' })).toBeDisabled({
    timeout: 90_000
  })
  await expect(library.getByTestId('fixture-library-count')).toHaveText('22 of 22')

  await page
    .getByRole('navigation', { name: 'Tabs' })
    .getByRole('link', { name: 'Compose', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: 'Unlocked · 12' })).toBeVisible({
    timeout: 60_000
  })
  await expect(page.getByTestId('locked-songs')).toHaveCount(0)
})
