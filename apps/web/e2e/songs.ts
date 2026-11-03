import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { coverageOf } from '../src/lib/pitch-coverage'
import type { Recording } from '../src/lib/recordings'
import type { GoldenIndex, GoldenRecording } from '../src/test-support/golden'
import { goldenAnalysisRecording } from '../src/test-support/golden-analysis'
import { songs } from '../src/test-support/songs.generated'
import { payToSave } from './pay'
import { fartAndSave } from './record'
import { tab } from './screens'
import { expect, test } from './test'

const golden = resolve(__dirname, '../../../fixtures/golden')
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T
const goldenIndex = readJson<GoldenIndex>(`${golden}/index.json`)

export const fixtureRecordings = (ids: readonly string[]) =>
  ids.map((id, i) =>
    goldenAnalysisRecording(
      readJson<GoldenRecording>(`${golden}/recordings/${id}.json`),
      i + 1,
      goldenIndex.sample_rate
    )
  )

export const fixtureLibrary = fixtureRecordings(goldenIndex.recordings)

export const songsUnlockedBy = (recordings: Recording[]) =>
  songs.filter(song => coverageOf(song, recordings).unlocked)

export const songsTheFixtureLibraryUnlocks = songsUnlockedBy(fixtureLibrary)

export const marysFarts = ['095', '017', '022', '002']

export const songsUnlockedAt = (takes: number) =>
  songsUnlockedBy(fixtureRecordings(marysFarts.slice(0, takes)))

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
  const progress = page.getByTestId('result-progress')
  const third = songsUnlockedAt(3)
  await fartAndSave(page, '022')
  for (const unlocked of third)
    await expect(progress).toContainText(`You unlocked ${unlocked.title}`)
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page).toHaveURL(/\/recordings\/$/)
  await tab(page, 'Record').click()
  await fartAndSave(page, '002')
  const fourth = songsUnlockedAt(4).length - third.length
  await expect(progress).toContainText(`You unlocked ${fourth} Songs`)
  await expect(progress).toContainText('Mary Had a Little Lamb · ')
}
