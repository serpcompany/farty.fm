import type { Page } from '@playwright/test'
import { songs } from '../src/lib/catalog/songs.generated'
import { payToSave } from './pay'
import { tab } from './screens'
import { expect, test } from './test'

const songsTooLongForTheFixtures = ['jingle', 'row', 'amazing', 'auld']

export const songsTheFixturesUnlock = songs.filter(s => !songsTooLongForTheFixtures.includes(s.id))

export function song(id: string) {
  const found = songs.find(s => s.id === id)
  if (!found) throw new Error(`No Song ${id}`)
  return found
}

export function needsTheFixtureLibrary(): void {
  test.beforeEach(async ({ request }) => {
    const onStagingBuild =
      process.env.E2E_SERVER === 'preview' &&
      (await request.get('/fixtures/recordings/index.json')).ok()
    test.skip(
      !onStagingBuild,
      'The Fixture Library is only in the Staging build (pnpm build:staging)'
    )
  })
}

export async function loadTheFixtureLibrary(page: Page): Promise<void> {
  const library = page.getByTestId('fixture-library')
  await library.getByRole('button', { name: 'Load the Fixture Library' }).click()
  await expect(library.getByRole('button', { name: 'Fixture Library loaded' })).toBeDisabled({
    timeout: 90_000
  })
}

export async function openASong(page: Page, songId: string): Promise<void> {
  await tab(page, 'Compose').click()
  await page
    .getByTestId('unlocked-songs')
    .locator(`[data-song="${songId}"]`)
    .getByRole('link')
    .click({ timeout: 60_000 })
  await expect(page).toHaveURL(new RegExp(`/compose/${songId}/$`))
  await expect(page.getByTestId('song-creator-state')).toBeVisible({ timeout: 60_000 })
}

export async function makeAToot(page: Page, songId: string): Promise<void> {
  await openASong(page, songId)
  await payToSave(page)
  await page.getByRole('link', { name: 'Back to Compose' }).click()
  await expect(page).toHaveURL(/\/compose\/$/)
}
