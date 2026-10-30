import { expect, test } from '@playwright/test'

// The Fixture Library loader on Profile, in the Staging build only (`pnpm build:staging` copies the
// fixtures and turns the loader on). Loading it unlocks all 12 Songs, since Songs play every burst
// of a fart (ADR 0016). Without fixture 002, Amazing Grace's 2.98 s note outlasts every fixture
// near it (ADR 0011).

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
  await expect(library.getByTestId('fixture-library-count')).toHaveText('0 of 38')
})

test('loads the Fixture Library and unlocks every Song it is long enough for', async ({ page }) => {
  test.setTimeout(120_000)

  await page.addInitScript(() => localStorage.setItem('pedos.welcomed', '1'))
  await page.goto('/profile/')
  const library = page.getByTestId('fixture-library')
  await expect(library.getByTestId('fixture-library-count')).toHaveText('0 of 38')
  await library.getByRole('button', { name: 'Load the Fixture Library' }).click()
  await expect(library.getByRole('button', { name: 'Fixture Library loaded' })).toBeDisabled({
    timeout: 90_000
  })
  await expect(library.getByTestId('fixture-library-count')).toHaveText('38 of 38')

  // A Recording shows its fart's length, rounded down, which "Needs" is measured against (#227).
  // Fixture 002 is Recording 1: a 4.039 s fart in a 4.2 s take, every burst of it (ADR 0016).
  const tabs = page.getByRole('navigation', { name: 'Tabs' })
  const recordings = tabs.getByRole('link', { name: 'Recordings', exact: true })
  const compose = tabs.getByRole('link', { name: 'Compose', exact: true })
  await recordings.click()
  const first = page
    .getByTestId('recording-row')
    .filter({ has: page.getByRole('button', { name: /^Recording 1,/ }) })
  await expect(first.getByTestId('recording-length')).toHaveText('4.0 s')

  // Songs play every burst of a fart (ADR 0016), so the whole library unlocks all 12 Songs.
  await compose.click()
  await expect(page.getByRole('heading', { name: 'Unlocked · 12' })).toBeVisible({
    timeout: 60_000
  })
  await expect(page.getByTestId('locked-songs')).toHaveCount(0)

  // Without Recording 1, Amazing Grace's 2.98 s note on E3 outlasts every fixture near it. It is
  // the only Song locked: since #282 finds 009 and 080 Melodic, the rest have their notes.
  await recordings.click()
  await page.getByRole('button', { name: 'Delete Recording 1', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete Recording' }).click()
  await expect(first).toHaveCount(0)
  await compose.click()
  await expect(page.getByRole('heading', { name: 'Unlocked · 11' })).toBeVisible({
    timeout: 60_000
  })
  await expect(page.getByRole('heading', { name: 'Locked · 1', exact: true })).toBeVisible()
  const amazing = page.getByRole('button', { name: 'Amazing Grace' })
  await expect(amazing).toHaveAccessibleDescription(
    'Locked. 5 of 6 notes covered. Needs E3 (3.0 s)'
  )
  await amazing.click()
  await expect(page.getByTestId('locked-song-needs')).toHaveText('Needs a fart near E3 (3.0 s).')
})
