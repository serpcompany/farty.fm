import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { songs } from '../src/test-support/songs.generated'
import { payToSave } from './pay'
import { fartAndSave } from './record'
import { tab } from './screens'
import { expect, test } from './test'

function unlockedByTheFixtureLibrary(id: string): boolean {
  const golden = resolve(__dirname, '../../../fixtures/golden/arrangements/full', `${id}.json`)
  return (JSON.parse(readFileSync(golden, 'utf8')) as { unlocked: boolean }).unlocked
}

export const songsTheFixtureLibraryUnlocks = songs.filter(s => unlockedByTheFixtureLibrary(s.id))

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

export async function recordTheFartsThatUnlockMary(page: Page): Promise<void> {
  for (const id of ['095', '017']) {
    await fartAndSave(page, id)
    await expect(page.getByTestId('result-progress')).not.toContainText('You unlocked')
    await page.getByRole('button', { name: 'Record another' }).click()
  }
  await recordTheLastTwoOfMarysFarts(page)
}

export async function recordTheLastTwoOfMarysFarts(page: Page): Promise<void> {
  await fartAndSave(page, '022')
  await expect(page.getByTestId('result-progress')).toContainText('You unlocked Hot Cross Buns')
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page).toHaveURL(/\/recordings\/$/)
  await tab(page, 'Record').click()
  await fartAndSave(page, '002')
  await expect(page.getByTestId('result-progress')).toContainText('You unlocked 5 Songs')
  await expect(page.getByTestId('result-progress')).toContainText('Mary Had a Little Lamb · ')
}
