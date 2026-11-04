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
  // Each row flips from the locked row it was 300 ms after the one before: its animation runs,
  // with the row's own delay (a theme variable on `:root` can't read it, globals.css).
  const flips = await reward.getByTestId('song-row').evaluateAll(rows =>
    rows.map(row =>
      row
        .getAnimations({ subtree: true })
        .filter(a => (a as CSSAnimation).animationName === 'unlock-before')
        .map(a => a.effect?.getTiming().delay)
    )
  )
  expect(flips).toEqual(unlocked.slice(0, shown).map((_, i) => [250 + 300 * i + 200]))
  await expect(reward.getByRole('button', { name: /^See all/ })).toHaveCount(count > 4 ? 1 : 0)
}

/** The ids of the Songs the reward lists, in its order. */
export function shownSongs(page: Page): Promise<(string | undefined)[]> {
  return page
    .getByTestId('unlock-reward')
    .getByTestId('song-row')
    .evaluateAll(rows => rows.map(row => (row as HTMLElement).dataset.song))
}
