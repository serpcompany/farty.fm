import { expect, type Page } from '@playwright/test'
import type { SongSummary } from '../src/lib/catalog/song'

/**
 * The Result's reward (#363) says how many Songs the take unlocked, counts up to it, and lists
 * them in this order: all of up to 4, else the first 3 and See all.
 */
export async function expectUnlockReward(page: Page, unlocked: readonly SongSummary[]) {
  const reward = page.getByTestId('unlock-reward')
  const count = unlocked.length
  await expect(reward).toContainText(count === 1 ? '1 Song unlocked' : `${count} Songs unlocked`)
  await expect(reward.getByTestId('unlock-count')).toHaveText(String(count))
  const shown = count <= 4 ? count : 3
  await expect(reward.getByTestId('song-row')).toHaveCount(shown)
  expect(await shownSongs(page)).toEqual(unlocked.slice(0, shown).map(song => song.id))
  await expect(reward.getByRole('button', { name: /^See all/ })).toHaveCount(count > 4 ? 1 : 0)
}

/** The ids of the Songs the reward lists, in its order. */
export function shownSongs(page: Page): Promise<(string | undefined)[]> {
  return page
    .getByTestId('unlock-reward')
    .getByTestId('song-row')
    .evaluateAll(rows => rows.map(row => (row as HTMLElement).dataset.song))
}
