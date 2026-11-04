import { expect, type Locator, type Page, test } from '@playwright/test'
import { newEmail, signInByApi } from './account'
import {
  fakeMicrophone,
  fartAndRecord,
  fixtureWavs,
  getUserMediaMs,
  waitForOpenMicrophone
} from './fake-microphone'
import { fixtureRecordings, songsUnlockedBy } from './golden'
import { skipWelcome } from './record'
import { onPhone } from './screens'

// Favorite Songs (#313) on Compose, signed in so they're kept with the account: a heart on an
// Unlocked Song's row and on a locked Song's sheet, the Favorites filter with search inside it
// and with the Ready filter (#356), the filters and the order kept over a reload, and the heart in
// Song Creator.
//
// Mary Had a Little Lamb unlocks with fixtures 095, 017, 022 and 002, with more Songs, and Hot
// Cross Buns at the third (`compose.spec.ts`), so the count follows the catalog (`golden.ts`).
const unlocked = songsUnlockedBy(fixtureRecordings(['095', '017', '022', '002'])).length

test.use({ permissions: ['microphone'] })

test.skip(({ viewport }) => !onPhone({ viewport }), 'Favorites are checked at phone size')

test.beforeEach(async ({ page }) => {
  await page.addInitScript(fakeMicrophone, { wavs: fixtureWavs(), delayMs: getUserMediaMs })
  await page.addInitScript(skipWelcome)
})

const MARY = 'Mary Had a Little Lamb'
const TWINKLE = 'Twinkle, Twinkle, Little Star'

function tab(page: Page, label: string) {
  return page
    .getByRole('navigation', { name: 'Tabs' })
    .getByRole('link', { name: label, exact: true })
}

const heart = (scope: Page | Locator, title: string) =>
  scope.getByRole('button', { name: `Favorite ${title}`, exact: true })

/** The account's Favorite Songs, as its library read lists them. */
async function accountFavorites(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const read: { favorites: string[] } = await (await fetch('/api/library/')).json()
    return read.favorites.sort()
  })
}

test('favorites Songs, filters by them and Ready, and keeps both over a reload', async ({
  page
}, testInfo) => {
  test.setTimeout(180_000)
  await page.goto('/profile/')
  await signInByApi(page, newEmail(testInfo, 'favorites'))
  await page.reload()

  // Four takes unlock Mary and more Songs; the third unlocks Hot Cross Buns, and a Result
  // that unlocks offers Done, not Record another (`compose.spec.ts`).
  await tab(page, 'Record').click()
  for (const id of ['095', '017', '022', '002']) {
    await waitForOpenMicrophone(page)
    await fartAndRecord(page, id)
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('result-note')).toBeVisible()
    if (id === '017' || id === '095') {
      await page.getByRole('button', { name: 'Record another' }).click()
    } else if (id === '022') {
      await expect(page.getByTestId('result-progress')).toContainText('You unlocked Hot Cross Buns')
      await page.getByRole('button', { name: 'Done' }).click()
      await tab(page, 'Record').click()
    }
  }
  await expect(page.getByTestId('result-progress')).toContainText(`${MARY} · `)
  await page.getByRole('button', { name: 'Done' }).click()
  await tab(page, 'Compose').click()
  await expect(
    page.getByRole('heading', { name: `Unlocked · ${unlocked}`, exact: true })
  ).toBeVisible()

  // No favorites yet: the filter says how to add one.
  const filter = page.getByRole('button', { name: 'Favorites', exact: true })
  await expectTappable(filter)
  await filter.click()
  await expect(filter).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('no-songs')).toContainText(
    'Tap the heart on a Song to add it to your Favorites.'
  )
  await expect(page.getByRole('button', { name: 'Show all Songs' })).toHaveCount(0)
  await expect(page.getByTestId('song-row')).toHaveCount(0)
  // With Ready on too it still says how to add one, and Show all Songs turns both off.
  const ready = page.getByRole('button', { name: 'Ready', exact: true })
  await ready.click()
  await expect(page.getByTestId('no-songs')).toContainText('No Favorites yet')
  await page.getByRole('button', { name: 'Show all Songs' }).click()
  await expect(filter).toHaveAttribute('aria-pressed', 'false')
  await expect(ready).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('no-songs')).toHaveCount(0)

  // The Unlocked Song's heart, on its row.
  await expectTappable(heart(page, MARY))
  await expect(heart(page, MARY)).toHaveAttribute('aria-pressed', 'false')
  await heart(page, MARY).click()
  await expect(heart(page, MARY)).toHaveAttribute('aria-pressed', 'true')

  // The locked Song's heart, on its sheet.
  await page.getByRole('button', { name: TWINKLE, exact: true }).click()
  const sheet = page.getByRole('dialog', { name: TWINKLE })
  await expectTappable(heart(sheet, TWINKLE))
  await heart(sheet, TWINKLE).click()
  await expect(heart(sheet, TWINKLE)).toHaveAttribute('aria-pressed', 'true')
  await sheet.getByRole('button', { name: 'Close' }).click()
  await expect(sheet).toBeHidden()
  await expect(heart(page, TWINKLE)).toHaveAttribute('aria-pressed', 'true')

  // The filter keeps both groups, and search works inside it.
  await filter.click()
  await expect(page.getByTestId('song-row')).toHaveCount(2)
  await expect(page.getByRole('heading', { name: 'Unlocked · 1', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Locked · 1', exact: true })).toBeVisible()
  await expect(page.getByText('Sound Pad')).toHaveCount(0)
  const search = page.getByRole('searchbox', { name: 'Search Songs or composers' })
  await search.fill('twinkle')
  await expect(page.getByTestId('song-row')).toHaveCount(1)
  await expect(page.getByTestId('song-row')).toHaveAttribute('data-song', 'twinkle')
  // A search the filter hides offers every Song, keeping the search.
  await search.fill('jingle')
  await expect(page.getByText('No Favorite Songs match “jingle”')).toBeVisible()
  await page.getByRole('button', { name: 'Search all Songs' }).click()
  await expect(filter).toHaveAttribute('aria-pressed', 'false')
  await expect(search).toHaveValue('jingle')
  await expect(page.locator('[data-song="jingle"]')).toBeVisible()
  await page.getByRole('button', { name: 'Clear search' }).click()

  // Ready and Favorites together: the Ready Favorite Songs, only Mary.
  await ready.click()
  await filter.click()
  await expect(page.getByTestId('song-row')).toHaveCount(1)
  await expect(page.getByTestId('song-row')).toHaveAttribute('data-song', 'mary')
  await page.getByRole('button', { name: 'Sort: Closest to unlocking' }).click()
  await page.getByRole('menuitemradio', { name: 'Fewest notes' }).click()
  await expect(page.getByRole('button', { name: 'Sort: Fewest notes' })).toBeVisible()

  // Both are on the account, and the order and filters are kept over a reload.
  await expect.poll(() => accountFavorites(page)).toEqual(['mary', 'twinkle'])
  await page.reload()
  await expect(filter).toHaveAttribute('aria-pressed', 'true')
  await expect(ready).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('song-row')).toHaveCount(1)
  await ready.click()
  await expect(page.getByTestId('song-row')).toHaveCount(2)
  await expect(heart(page, MARY)).toHaveAttribute('aria-pressed', 'true')
  await expect(heart(page, TWINKLE)).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Sort: Fewest notes' }).click()
  await expect(page.getByRole('menuitemradio', { name: 'Fewest notes' })).toBeChecked()
  await page.keyboard.press('Escape')
  await filter.click()

  // Song Creator's heart takes Mary off.
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

  // Twinkle, the one Favorite left, is locked: Ready leaves nothing, and Show all Songs turns both
  // filters off.
  await ready.click()
  await expect(page.getByTestId('song-row')).toHaveCount(0)
  await expect(page.getByTestId('no-songs')).toContainText('No Ready Favorites')
  await expect(page.getByTestId('no-songs')).toContainText(
    'None of your Favorites is unlocked yet.'
  )
  await page.getByRole('button', { name: 'Show all Songs' }).click()
  await expect(filter).toHaveAttribute('aria-pressed', 'false')
  await expect(ready).toHaveAttribute('aria-pressed', 'false')
  await expect(
    page.getByRole('heading', { name: `Unlocked · ${unlocked}`, exact: true })
  ).toBeVisible()
})

/** A control a thumb can hit: at least 44 by 44 CSS pixels, as the iPhone's controls. */
async function expectTappable(control: Locator) {
  const box = await control.boundingBox()
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
}
