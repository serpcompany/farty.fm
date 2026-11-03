import type { Locator, Page } from '@playwright/test'
import { accountLibrary, newEmail, signInByApi } from './account'
import { withFartingMicrophone } from './record'
import { expectTappable, lockedSong, onPhone, songsHeading, tab } from './screens'
import { recordTheFartsThatUnlockMary, songsUnlockedAt } from './songs'
import { expect, test } from './test'

test.skip(({ viewport }) => !onPhone({ viewport }), 'Favorites are checked at phone size')
withFartingMicrophone()

const MARY = 'Mary Had a Little Lamb'
const TWINKLE = 'Twinkle, Twinkle, Little Star'

const heart = (scope: Page | Locator, title: string) =>
  scope.getByRole('button', { name: `Favorite ${title}`, exact: true })

async function accountFavorites(page: Page): Promise<string[]> {
  return (await accountLibrary(page)).favorites.sort()
}

test('favorites Songs, filters and sorts by them, and keeps them over a reload', async ({
  page
}, testInfo) => {
  test.setTimeout(180_000)
  await page.goto('/profile/')
  await signInByApi(page, newEmail(testInfo, 'favorites'))
  await page.reload()

  await tab(page, 'Record').click()
  await recordTheFartsThatUnlockMary(page)
  await page.getByRole('button', { name: 'Done' }).click()
  await tab(page, 'Compose').click()
  await expect(songsHeading(page, 'Unlocked', songsUnlockedAt(4).length)).toBeVisible()

  const filter = page.getByRole('button', { name: 'Favorites', exact: true })
  await expectTappable(filter)
  await filter.click()
  await expect(filter).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('no-favorites')).toContainText(
    'Tap the heart on a Song to add it to your Favorites.'
  )
  await expect(page.getByTestId('song-row')).toHaveCount(0)
  await filter.click()
  await expect(filter).toHaveAttribute('aria-pressed', 'false')

  await expectTappable(heart(page, MARY))
  await expect(heart(page, MARY)).toHaveAttribute('aria-pressed', 'false')
  await heart(page, MARY).click()
  await expect(heart(page, MARY)).toHaveAttribute('aria-pressed', 'true')

  await lockedSong(page, TWINKLE).click()
  const sheet = page.getByRole('dialog', { name: TWINKLE })
  await expectTappable(heart(sheet, TWINKLE))
  await heart(sheet, TWINKLE).click()
  await expect(heart(sheet, TWINKLE)).toHaveAttribute('aria-pressed', 'true')
  await sheet.getByRole('button', { name: 'Close' }).click()
  await expect(sheet).toBeHidden()
  await expect(heart(page, TWINKLE)).toHaveAttribute('aria-pressed', 'true')

  await filter.click()
  await expect(page.getByTestId('song-row')).toHaveCount(2)
  await expect(songsHeading(page, 'Unlocked', 1)).toBeVisible()
  await expect(songsHeading(page, 'Locked', 1)).toBeVisible()
  await expect(page.getByText('Sound Pad')).toHaveCount(0)
  const search = page.getByRole('searchbox', { name: 'Search Songs' })
  await search.fill('twinkle')
  await expect(page.getByTestId('song-row')).toHaveCount(1)
  await expect(page.getByTestId('song-row')).toHaveAttribute('data-song', 'twinkle')
  await search.fill('jingle')
  await expect(page.getByText('No Results for “jingle”')).toBeVisible()
  await search.fill('')
  await filter.click()

  const firstLocked = page.getByTestId('locked-songs').getByTestId('song-row').first()
  await page.getByRole('button', { name: 'Sort' }).click()
  await page.getByRole('menuitemradio', { name: 'Favorites first' }).click()
  await page.keyboard.press('Escape')
  await expect(firstLocked).toHaveAttribute('data-song', 'twinkle')
  await filter.click()

  await expect.poll(() => accountFavorites(page)).toEqual(['mary', 'twinkle'])
  await page.reload()
  await expect(filter).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('song-row')).toHaveCount(2)
  await expect(heart(page, MARY)).toHaveAttribute('aria-pressed', 'true')
  await expect(heart(page, TWINKLE)).toHaveAttribute('aria-pressed', 'true')
  await filter.click()
  await expect(firstLocked).toHaveAttribute('data-song', 'twinkle')
  await page.getByRole('button', { name: 'Sort' }).click()
  await expect(page.getByRole('menuitemradio', { name: 'Favorites first' })).toBeChecked()
  await page.keyboard.press('Escape')

  await page
    .getByTestId('unlocked-songs')
    .getByRole('link', { name: new RegExp(`^${MARY}`) })
    .click()
  await expect(page).toHaveURL(/\/compose\/mary\/$/)
  await expectTappable(heart(page, MARY))
  await expect(heart(page, MARY)).toHaveAttribute('aria-pressed', 'true')
  await heart(page, MARY).click()
  await expect(heart(page, MARY)).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('link', { name: 'Back to Compose' }).click()
  await filter.click()
  await expect(page.getByTestId('song-row')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: /^Unlocked/ })).toHaveCount(0)
  await expect.poll(() => accountFavorites(page)).toEqual(['twinkle'])
})
