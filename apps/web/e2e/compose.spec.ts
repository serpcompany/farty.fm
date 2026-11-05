import { expect, type Locator, type Page, test } from '@playwright/test'
import { searchKey } from '../src/lib/catalog/search-key'
import { kindChoices, type SongKind } from '../src/lib/catalog/song'
import { songs } from '../src/lib/catalog/songs.generated'
import { type SongOrder, songRows, sortRows } from '../src/lib/pitch-coverage'
import { dropdown, menuRow, pick } from './compose-filters'
import {
  fakeMicrophone,
  fartAndRecord,
  fixtureWavs,
  getUserMediaMs,
  storedRecordings,
  waitForOpenMicrophone
} from './fake-microphone'
import {
  fixtureRecordings,
  songsTheLastStoredTakeUnlocks,
  songsTheLastTakeUnlocks,
  songsUnlockedBy
} from './golden'
import { skipWelcome } from './record'
import { expectUnlockReward, shownSongs } from './unlock-reward'

// Compose and the Result screen, with Recordings made through the fake microphone in
// `fake-microphone.ts`, which plays each fart as the person presses Record, all on one page.
//
// Mary Had a Little Lamb unlocks with fixtures 095 (F2), 017 (D♯2), 022 (E2) and 002 (A♯2), with
// more Songs, and Hot Cross Buns unlocks before the fourth, at the third: the app's Pitch Coverage
// on the reference's analysis of these four (`golden.ts`), so the counts follow the catalog. Songs
// play each fart raw, at its own length (ADR 0012), so Mary's last note, 1.40 s long, needs 002
// (4.04 s with every burst, ADR 0016), the only one of the four that long (ADR 0011).
const journey = ['095', '017', '022', '002']
/** The Songs the journey's first `takes` takes unlock. */
const unlockedAt = (takes: number) => songsUnlockedBy(fixtureRecordings(journey.slice(0, takes)))

/** A Song's composer (#357), notes, tempo and length in whole seconds, from the catalog (#356). */
function facts(id: string) {
  const song = songs.find(s => s.id === id)
  if (!song) throw new Error(`No Song ${id}`)
  if (!song.composer) throw new Error(`Song ${id} has no composer`)
  return {
    composer: song.composer,
    notes: song.pitches.length,
    bpm: song.bpm,
    seconds: Math.round((song.lengthBeats * 60) / song.bpm)
  }
}

/**
 * The ids of the Songs whose title, other names, composer, kind or origin (#384) has `query`, from
 * the catalog. Every Song is a Song, so the kind Songs is no search word.
 */
const searchFinds = (query: string) =>
  songs
    .filter(song =>
      [
        song.title,
        ...(song.aliases ?? []),
        song.composer ?? '',
        song.kind === 'Songs' ? '' : song.kind,
        song.origin ?? ''
      ].some(name => searchKey(name).includes(searchKey(query)))
    )
    .map(song => song.id)

test.use({ permissions: ['microphone'] })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(fakeMicrophone, { wavs: fixtureWavs(), delayMs: getUserMediaMs })
  await page.addInitScript(skipWelcome)
})

function tab(page: Page, label: string) {
  return page
    .getByRole('navigation', { name: 'Tabs' })
    .getByRole('link', { name: label, exact: true })
}

/** Once Record's microphone is open, farts fixture `id` into it and saves the take. */
async function recordAndSave(page: Page, id: string) {
  await waitForOpenMicrophone(page)
  await fartAndRecord(page, id)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('result-note')).toBeVisible()
}

test('saving farts unlocks Songs on Compose, and the Result says so', async ({ page }) => {
  test.setTimeout(120_000)

  // Before any Recording, every Song is locked and Compose says how to start.
  await page.goto('/compose/')
  await expect(page.getByText('No Melodic Recordings yet')).toBeVisible()
  const locked = (count: number) =>
    page.getByRole('heading', { name: `Locked · ${count}`, exact: true })
  await expect(locked(songs.length)).toBeVisible()
  await expect(page.getByRole('heading', { name: /^Unlocked/ })).toHaveCount(0)

  // Ready shows only the Unlocked Songs: none yet.
  const show = dropdown(page, 'Show')
  await expectTappable(show)
  await pick(page, 'Show', 'Ready')
  await expect(show).toHaveAccessibleName('Show: Ready')
  await expect(page.getByText('No Ready Songs yet')).toBeVisible()
  await expect(page.getByTestId('song-row')).toHaveCount(0)
  await page.getByRole('button', { name: 'Show all Songs' }).click()
  await expect(show).toHaveAccessibleName('Show')
  await expect(locked(songs.length)).toBeVisible()

  // A locked Song's sheet: no Melodic Recordings yet.
  await page.getByRole('button', { name: 'Mary Had a Little Lamb', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: 'Mary Had a Little Lamb' })
  await expect(sheet.getByTestId('locked-song-needs')).toHaveText(
    'Record a fart with a clear note to start.'
  )
  await expect(sheet.getByTestId('pitch-strip')).toHaveAccessibleName('No notes collected yet')
  await expectTappable(sheet.getByRole('button', { name: 'Close' }))
  await sheet.getByRole('button', { name: 'Close' }).click()
  await expect(sheet).toBeHidden()

  // The first take: F2, collected on the Result's pitch strip. Nothing unlocks yet.
  await tab(page, 'Record').click()
  await recordAndSave(page, '095')
  await expect(page.getByTestId('result-note')).toHaveText('F2')
  await expect(page.getByTestId('pitch-strip')).toHaveAccessibleName('Notes collected: F. New: F')
  await expect(page.getByTestId('unlock-reward')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Record another' })).toBeVisible()
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page).toHaveURL(/\/recordings\/$/)

  await tab(page, 'Compose').click()
  await expect(page.getByText('No Melodic Recordings yet')).toHaveCount(0)
  await expect(locked(songs.length)).toBeVisible()
  // A locked row: its title, its composer (#357), and its facts, Pitch Coverage first (#356).
  const mary = page.getByRole('button', { name: 'Mary Had a Little Lamb', exact: true })
  const { composer, notes, bpm, seconds } = facts('mary')
  await expect(mary).toContainText(composer)
  await expect(mary).toContainText(`1 of ${notes} notes · ${bpm} BPM · ${seconds} s`)
  await expect(mary).toHaveAccessibleDescription(
    `Locked. ${composer}. 1 of ${notes} notes covered, ${bpm} BPM, ${seconds} seconds`
  )

  // The locked Song's sheet names the notes it needs, and how long a fart each needs (ADR 0011).
  // Which notes depends on the take's settle time (two Arrangements nearly tie), so the journey
  // checks the shape; `pitch-coverage.test.ts` pins the exact notes on the golden 095. Record
  // goes to the Record tab.
  await mary.click()
  await expect(sheet.getByTestId('locked-song-needs')).toHaveText(
    /^Needs a fart near [A-G]♯?\d \(\d\.\d s\), [A-G]♯?\d \(\d\.\d s\), and [A-G]♯?\d \(\d\.\d s\)\.$/
  )
  await expect(sheet.getByTestId('pitch-strip')).toHaveAccessibleName(
    /^Notes collected: F\. Needed: /
  )
  await sheet.getByRole('button', { name: 'Record' }).click()
  await expect(sheet).toBeHidden()
  await expect(page.getByTestId('record-button')).toBeVisible()

  // Three more takes: the third unlocks Hot Cross Buns, and the fourth Mary and more Songs.
  expect(unlockedAt(2)).toEqual([])
  // What holds whichever side of a Song's edge a take's measured length lands on (#378).
  const thirdByReference = songsTheLastTakeUnlocks(journey.slice(0, 3)).map(s => s.title)
  expect(thirdByReference).toContain('Hot Cross Buns')
  expect(thirdByReference).not.toContain('Mary Had a Little Lamb')
  expect(songsTheLastTakeUnlocks(journey).length).toBeGreaterThan(4)
  await recordAndSave(page, '017')
  await expect(page.getByTestId('unlock-reward')).toHaveCount(0)
  await page.getByRole('button', { name: 'Record another' }).click()
  // The Result's reward lists the Songs the take unlocked, most viewed first (#363).
  await recordAndSave(page, '022')
  // The reward is worked out from the app's own analysis of the takes, which can differ from the
  // reference's by a 5 ms step, enough to unlock one more Song (#378).
  await expect(page.getByTestId('unlock-reward')).toBeVisible()
  const third = songsTheLastStoredTakeUnlocks(await storedRecordings(page), journey.slice(0, 3))
  expect(third.map(s => s.title)).toContain('Hot Cross Buns')
  expect(third.map(s => s.title)).not.toContain('Mary Had a Little Lamb')
  await expectUnlockReward(page, third)
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page).toHaveURL(/\/recordings\/$/)
  await tab(page, 'Record').click()
  await recordAndSave(page, '002')
  await expect(page.getByTestId('unlock-reward')).toBeVisible()
  const fourth = songsTheLastStoredTakeUnlocks(await storedRecordings(page), journey)
  expect(fourth.length).toBeGreaterThan(4)

  // More than 4 show 3, then See all, which lists the rest and moves focus to the 4th.
  await expectUnlockReward(page, fourth)
  const reward = page.getByTestId('unlock-reward')
  await expectTappable(reward.getByRole('button', { name: `See all ${fourth.length} Songs` }))
  await reward.getByRole('button', { name: `See all ${fourth.length} Songs` }).click()
  expect(await shownSongs(page)).toEqual(fourth.map(s => s.id))
  await expect(reward.getByRole('button', { name: /^See all/ })).toHaveCount(0)
  await expect(reward.getByTestId('song-row').nth(3).getByRole('link')).toBeFocused()
  await expect(reward.getByTestId('song-row').nth(3).getByRole('link')).toHaveAccessibleName(
    fourth[3].title
  )
  // After an unlock, Try it opens the reward's first Song in Song Creator, and Done goes to
  // Recordings.
  await expect(page.getByRole('button', { name: 'Record another' })).toHaveCount(0)
  await expectTappable(page.getByRole('button', { name: 'Done' }))
  await expectTappable(page.getByRole('button', { name: 'Try it' }))
  // Try it starts the sound while it handles the tap, as iPhone Safari needs, so Song Creator
  // plays the Toot by itself once it's made. A click reaches the window first while capturing
  // and last while bubbling, so the page's own handlers run in between.
  await page.evaluate(() => {
    const counted = window as unknown as { resumesInTaps: number }
    counted.resumesInTaps = 0
    let inTap = false
    addEventListener('click', () => (inTap = true), { capture: true })
    addEventListener('click', () => (inTap = false))
    const resume = AudioContext.prototype.resume
    AudioContext.prototype.resume = function (this: AudioContext) {
      if (inTap) counted.resumesInTaps += 1
      return resume.call(this)
    }
  })
  await page.getByRole('button', { name: 'Try it' }).click()
  expect(
    await page.evaluate(() => (window as unknown as { resumesInTaps: number }).resumesInTaps)
  ).toBe(1)
  await expect(page).toHaveURL(new RegExp(`/compose/${fourth[0].id}/$`))
  await expect(page.getByRole('heading', { name: fourth[0].title })).toBeVisible()

  // Back returns to Compose, where the Unlocked Song opens Song Creator too.
  await page.getByRole('link', { name: 'Back to Compose' }).click()
  await expect(page).toHaveURL(/\/compose\/$/)
  // A reload continues a guest's visit (`visit.ts`), so from here Compose and Recordings read the
  // four Recordings back from storage.
  await page.reload()
  const unlockedSongs = unlockedAt(4).length
  await expect(
    page.getByRole('heading', { name: `Unlocked · ${unlockedSongs}`, exact: true })
  ).toBeVisible()
  await expect(locked(songs.length - unlockedSongs)).toBeVisible()
  const unlocked = page
    .getByTestId('unlocked-songs')
    .locator('[data-song="mary"]')
    .getByRole('link')
  await expect(unlocked).toHaveAccessibleName('Mary Had a Little Lamb')
  await expect(unlocked).toHaveAccessibleDescription(
    `${composer}. ${notes} notes, ${bpm} BPM, ${seconds} seconds`
  )
  await expectTappable(unlocked)
  await unlocked.click()
  await expect(page).toHaveURL(/\/compose\/mary\/$/)
  await expect(page.getByRole('heading', { name: 'Mary Had a Little Lamb' })).toBeVisible()
  await expect(page.getByTestId('recording-used')).toHaveCount(4)
  await page.getByRole('link', { name: 'Back to Compose' }).click()

  await tab(page, 'Recordings').click()
  await expect(page.getByTestId('recording-row')).toHaveCount(4)
  await tab(page, 'Compose').click()

  // A choice that changes the list goes back to the first Song, which a list scrolled far down
  // would otherwise hide. Coming back from Song Creator keeps your place, with the choice still on.
  const scrolled = () => page.evaluate(() => window.scrollY)
  const scrollDown = () => page.evaluate(() => window.scrollTo(0, 600))
  await expect(locked(songs.length - unlockedSongs)).toBeVisible()
  await scrollDown()
  expect(await scrolled()).toBe(600)
  await pick(page, 'Kind', 'Well known')
  await expect.poll(scrolled).toBe(0)
  const lastUnlocked = page.getByTestId('unlocked-songs').getByRole('link').last()
  await lastUnlocked.evaluate(row =>
    window.scrollTo(0, row.getBoundingClientRect().top + window.scrollY - 200)
  )
  const place = await scrolled()
  expect(place).toBeGreaterThan(0)
  await lastUnlocked.click()
  await expect(page).not.toHaveURL(/\/compose\/$/)
  await expect(page.getByRole('link', { name: 'Back to Compose' })).toBeVisible()
  await page.getByRole('link', { name: 'Back to Compose' }).click()
  await expect(page).toHaveURL(/\/compose\/$/)
  await expect(lastUnlocked).toBeVisible()
  await expect.poll(scrolled).toBe(place)
  expect(await dropdown(page, 'Kind').textContent()).toBe('Well known')
  await page.getByRole('button', { name: 'Clear Kind' }).click()
  await expect.poll(scrolled).toBe(0)

  // Sort's order does too, but a tap that changes nothing leaves your place alone.
  // A thumb's tap on the row: Playwright's click would first scroll the page to it.
  const tapRow = async (row: Locator) => {
    await expect(row).toBeVisible()
    const box = await row.boundingBox()
    await page.touchscreen.tap((box?.x ?? 0) + 40, (box?.y ?? 0) + 22)
  }
  await scrollDown()
  await page.getByRole('button', { name: 'Sort: Closest to unlocking' }).click()
  await tapRow(page.getByRole('menuitemradio', { name: 'Closest to unlocking' }))
  await expect(page.getByRole('menu')).toHaveCount(0)
  await dropdown(page, 'Kind').click()
  await tapRow(menuRow(page, 'All kinds'))
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  expect(await scrolled()).toBe(600)
  await page.getByRole('button', { name: 'Sort: Closest to unlocking' }).click()
  await page.getByRole('menuitemradio', { name: 'A–Z' }).click()
  await expect.poll(scrolled).toBe(0)
  await page.getByRole('button', { name: 'Sort: A–Z' }).click()
  await page.getByRole('menuitemradio', { name: 'Closest to unlocking' }).click()
  await expect(page.getByRole('menu')).toHaveCount(0)

  // Search, by title or composer, with its clear button.
  const search = page.getByRole('searchbox', { name: 'Search Songs or composers' })
  await expectTappable(search)
  // Every Song with "little" in its title, another name or its composer, from the catalog.
  const little = searchFinds('little')
  expect(little).toContain('mary')
  await search.fill('LITTLE')
  await expect(page.getByTestId('song-row')).toHaveCount(little.length)
  // Mozart's Songs, by their composer: none has "Mozart" in its title (#356).
  const mozart = searchFinds('mozart')
  expect(mozart.length).toBeGreaterThan(1)
  expect(songs.filter(s => mozart.includes(s.id) && /mozart/i.test(s.title))).toEqual([])
  await search.fill('Mozart')
  await expect(page.getByTestId('song-row')).toHaveCount(mozart.length)
  // Each row shows its composer under the title.
  for (const id of mozart) {
    const song = songs.find(s => s.id === id)
    await expect(page.locator(`[data-song="${id}"]`)).toContainText(
      `${song?.title}${song?.composer}`
    )
  }
  await search.fill('zzz')
  await expect(page.getByText('No Results for “zzz”')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Search all Songs' })).toHaveCount(0)
  await expectTappable(page.getByRole('button', { name: 'Clear search' }))
  await page.getByRole('button', { name: 'Clear search' }).click()
  await expect(search).toHaveValue('')
  await expect(search).toBeFocused()
  await expect(locked(songs.length - unlockedSongs)).toBeVisible()

  // Ready: only the Unlocked Songs. A search the filter hides offers every Song.
  await pick(page, 'Show', 'Ready')
  await expect(page.getByTestId('song-row')).toHaveCount(unlockedSongs)
  await expect(page.getByRole('heading', { name: /^Locked/ })).toHaveCount(0)
  await expect(page.getByText('Sound Pad')).toHaveCount(0)
  await search.fill('zzz')
  await expect(page.getByText('No Ready Songs match “zzz”')).toBeVisible()
  await page.getByRole('button', { name: 'Search all Songs' }).click()
  await expect(show).toHaveAccessibleName('Show')
  await expect(search).toHaveValue('zzz')
  await expect(page.getByText('No Results for “zzz”')).toBeVisible()
  await search.fill('')

  // Sort names the order. Most popular puts the best-known Song first (#356, #384).
  const sort = (label: string) => page.getByRole('button', { name: `Sort: ${label}` })
  await expectTappable(sort('Closest to unlocking'))
  await expectTappable(dropdown(page, 'Kind'))
  const rows = songRows(songs, fixtureRecordings(journey))
  /** The first Song of each section in `order`, by the app's own sort. */
  const firsts = (order: SongOrder) => {
    const sorted = sortRows(rows, order)
    return [sorted.find(r => r.coverage.unlocked), sorted.find(r => !r.coverage.unlocked)].map(
      r => r?.song.id ?? ''
    )
  }
  const firstUnlocked = page.getByTestId('unlocked-songs').getByTestId('song-row').first()
  const firstLocked = page.getByTestId('locked-songs').getByTestId('song-row').first()
  await sort('Closest to unlocking').click()
  await expect(page.getByRole('menuitemradio')).toHaveText([
    'Closest to unlocking',
    'Most popular',
    'Fewest notes',
    'A–Z'
  ])
  await page.getByRole('menuitemradio', { name: 'Most popular' }).click()
  await expect(sort('Most popular')).toBeVisible()
  const [popularUnlocked, popularLocked] = firsts('mostPopular')
  const fame = (id: string) => songs.find(s => s.id === id)?.fame ?? 0
  expect(fame(popularLocked)).toBe(
    Math.max(...rows.filter(r => !r.coverage.unlocked).map(r => r.song.fame))
  )
  await expect(firstUnlocked).toHaveAttribute('data-song', popularUnlocked)
  await expect(firstLocked).toHaveAttribute('data-song', popularLocked)
  // The first locked Song by the app's A–Z order, which puts a title that starts with a number
  // first.
  await sort('Most popular').click()
  await page.getByRole('menuitemradio', { name: 'A–Z' }).click()
  await expect(firstLocked).toHaveAttribute('data-song', firsts('alphabetical')[1])
})

// The Kind dropdown (#397): several kinds at once, or the Well known Songs of every kind, with
// search and the Show dropdown. Its top row and its × show every Song, and Compose keeps the choice.
test('the Kind dropdown picks several kinds, with search and Show, and stays chosen', async ({
  page
}) => {
  await page.goto('/compose/')
  const kind = dropdown(page, 'Kind')
  const clear = page.getByRole('button', { name: 'Clear Kind' })
  const row = (name: string) => menuRow(page, name)
  const rows = page.getByTestId('song-row')
  const ofKind = (kind: SongKind) => songs.filter(s => s.kind === kind)
  await expect(page.getByRole('heading', { name: `Locked · ${songs.length}` })).toBeVisible()
  await expect(kind).toHaveText('Kind')
  await expect(clear).toHaveCount(0)

  await kind.click()
  const items = page.getByRole('menuitemcheckbox')
  await expect(items).toHaveText(['All kinds', ...kindChoices])
  for (const item of await items.all()) await expectTappable(item)
  await expect(page.getByRole('menuitemcheckbox', { checked: true })).toHaveText(['All kinds'])

  // Well known holds Songs of every kind. The menu stays open, and the list changes behind it.
  const wellKnown = songs.filter(s => s.wellKnown)
  expect(new Set(wellKnown.map(s => s.kind)).size).toBeGreaterThan(4)
  await row('Well known').click()
  await expect(rows).toHaveCount(wellKnown.length)
  await expect(row('Well known')).toBeChecked()
  await expect(row('All kinds')).not.toBeChecked()
  await expect(page.getByText('Sound Pad')).toHaveCount(0)

  // Several: a Song in any of them shows, once.
  await row('Christmas').click()
  await row('Anthems').click()
  await expect(rows).toHaveCount(
    songs.filter(s => s.wellKnown || s.kind === 'Christmas' || s.kind === 'Anthems').length
  )
  await row('Well known').click()
  await expect(rows).toHaveCount(ofKind('Christmas').length + ofKind('Anthems').length)

  // A tap outside closes the menu and opens nothing behind it. It names how many, or the one left.
  await tapOutside(page)
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(kind).toHaveText('Kind · 2')
  await expect(kind).toHaveAccessibleName('Kind: Christmas, Anthems')
  await expectTappable(clear)
  await pick(page, 'Kind', 'Anthems')
  await expect(kind).toHaveText('Christmas')

  // The top row turns them all off, and so does the ×.
  await pick(page, 'Kind', 'All kinds')
  await expect(kind).toHaveText('Kind')
  await expect(clear).toHaveCount(0)
  await expect(page.getByRole('heading', { name: `Locked · ${songs.length}` })).toBeVisible()
  await expect(page.getByText('Sound Pad')).toBeVisible()
  await pick(page, 'Kind', 'Hymns', 'Kids')
  await clear.click()
  await expect(kind).toHaveText('Kind')
  await expect(kind).toBeFocused()
  await expect(rows).toHaveCount(songs.length)

  // Search finds a Song by where it's from, and by its kind's name.
  const search = page.getByRole('searchbox', { name: 'Search Songs or composers' })
  const irish = searchFinds('Irish')
  const irishByName = songs.filter(s =>
    [s.title, s.composer ?? ''].some(name => /irish/i.test(name))
  )
  expect(irish.length).toBeGreaterThan(irishByName.length)
  await search.fill('Irish')
  await expect(rows).toHaveCount(irish.length)
  expect(searchFinds('christmas')).toEqual(
    expect.arrayContaining(ofKind('Christmas').map(s => s.id))
  )
  await search.fill('christmas')
  await expect(rows).toHaveCount(searchFinds('christmas').length)

  // Kind and search together, then Ready too: no Song is Unlocked yet.
  await search.fill('Irish')
  await pick(page, 'Kind', 'Fiddle tunes')
  const irishTunes = ofKind('Fiddle tunes').filter(s => irish.includes(s.id))
  await expect(kind).toHaveText('Fiddle tunes')
  await expect(rows).toHaveCount(irishTunes.length)
  await pick(page, 'Show', 'Ready')
  await expect(page.getByText('No Ready Songs in Fiddle tunes match “Irish”')).toBeVisible()
  await page.getByRole('button', { name: 'Search all Songs' }).click()
  await expect(kind).toHaveText('Kind')
  await expect(dropdown(page, 'Show')).toHaveText('Show')
  await expect(search).toHaveValue('Irish')
  await expect(rows).toHaveCount(irish.length)

  // The choices stay across a reload, filled.
  await search.fill('')
  await pick(page, 'Kind', 'Fiddle tunes', 'Hymns')
  await page.reload()
  await expect(kind).toHaveText('Kind · 2')
  await expect(clear).toBeVisible()
  await expect(rows).toHaveCount(ofKind('Fiddle tunes').length + ofKind('Hymns').length)

  // So does the one Kind a browser kept before several could be chosen.
  await page.evaluate(() => localStorage.setItem('pedos.composeKind', 'Fiddle tunes'))
  await page.reload()
  await expect(kind).toHaveText('Fiddle tunes')
  await expect(clear).toBeVisible()
  await expect(rows).toHaveCount(ofKind('Fiddle tunes').length)
})

// The row at the narrowest phones (#397), with its longest names on: a Kind's, a filter's and the
// order's. Nothing runs off the screen, and Sort shows its whole label, or only its icon, never a
// piece of a word. The app clips sideways overflow, so the row's right edge is what's measured.
test('the filter row fits a phone, and its menus stay on the screen', async ({ page }) => {
  await page.goto('/compose/')
  await pick(page, 'Kind', 'Fiddle tunes')
  await pick(page, 'Show', 'Favorites')
  await page.getByRole('button', { name: 'Sort: Closest to unlocking' }).click()
  await page.getByRole('menuitemradio', { name: 'Fewest notes' }).click()
  const menu = page.getByRole('menu')
  await expect(menu).toHaveCount(0)
  const sort = page.getByRole('button', { name: 'Sort: Fewest notes' })
  /** Neither filter's name is cut short. */
  const expectWholeNames = async () => {
    for (const name of ['Kind', 'Show'] as const) {
      const cut = await dropdown(page, name)
        .locator('span')
        .evaluate(label => label.scrollWidth > label.clientWidth)
      expect(cut).toBe(false)
    }
  }

  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(dropdown(page, 'Kind')).toHaveText('Fiddle tunes')
    await expect(dropdown(page, 'Show')).toHaveText('Favorites')
    await expect(async () => {
      expect(['', 'Fewest notes']).toContain(await sort.textContent())
      // The three pills side by side, inside the page's margin. Only tap areas reach past them.
      const pills = await page
        .getByTestId('song-filters')
        .locator('button[aria-haspopup]')
        .evaluateAll(buttons => buttons.map(b => b.parentElement?.getBoundingClientRect()))
      expect(pills).toHaveLength(3)
      const [kind, show, sorted] = pills
      expect(kind?.right ?? 999).toBeLessThanOrEqual(show?.left ?? 0)
      expect(show?.right ?? 999).toBeLessThanOrEqual(sorted?.left ?? 0)
      expect(sorted?.right ?? 999).toBeLessThanOrEqual(width - 16)
    }).toPass()
    await expectTappable(sort)
    for (const name of ['Clear Kind', 'Clear Show']) {
      await expectTappable(page.getByRole('button', { name }))
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    await expectWholeNames()
  }

  // Each menu stays on a small phone's screen, and scrolls if it must.
  await page.setViewportSize({ width: 320, height: 568 })
  for (const open of [dropdown(page, 'Kind'), dropdown(page, 'Show'), sort]) {
    await open.click()
    await expect(menu).toBeVisible()
    // Measured at its full size, once it has grown in.
    await menu.evaluate(el =>
      Promise.allSettled(el.getAnimations().map(a => a.finished)).then(() => null)
    )
    const box = await menu.boundingBox()
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0)
    expect(box?.y ?? -1).toBeGreaterThanOrEqual(0)
    expect((box?.x ?? 0) + (box?.width ?? 999)).toBeLessThanOrEqual(320)
    expect((box?.y ?? 0) + (box?.height ?? 999)).toBeLessThanOrEqual(568)
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
  }

  // With a system font too wide for one row, whatever this machine's is, Sort takes its own line.
  await page.addStyleTag({ content: '[data-testid="song-filters"] { letter-spacing: 0.1em }' })
  await expect
    .poll(async () => {
      const [show, sorted] = await Promise.all([
        dropdown(page, 'Show').boundingBox(),
        sort.boundingBox()
      ])
      return (sorted?.y ?? 0) > (show?.y ?? 0)
    })
    .toBe(true)
  await expectWholeNames()
  const right = await page
    .getByTestId('song-filters')
    .locator('button[aria-haspopup]')
    .evaluateAll(buttons =>
      Math.max(...buttons.map(b => b.parentElement?.getBoundingClientRect().right ?? 999))
    )
  expect(right).toBeLessThanOrEqual(320 - 16)
})

// The browser fetches the Song Catalog as data (#322). With no service worker to answer for it, a
// catalog the server won't give says so on Compose and Profile, and Try again loads it.
test.describe('a Song Catalog that does not load', () => {
  test.use({ serviceWorkers: 'block' })

  test('says so on Compose and Profile, and Try again loads it', async ({ page, context }) => {
    await context.route('**/catalog/**', route => route.fulfill({ status: 500, body: 'down' }))
    await page.goto('/compose/')
    await expect(page.getByText("Couldn't load the Songs.")).toBeVisible()
    await page.goto('/profile/')
    await expect(page.getByText("Couldn't load the Songs.")).toBeVisible()

    await context.unroute('**/catalog/**')
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByTestId('stat-songs')).toHaveText(`Songs unlocked0 of ${songs.length}`)
    await tab(page, 'Compose').click()
    await expect(page.getByRole('heading', { name: `Locked · ${songs.length}` })).toBeVisible()
  })

  // A Song's notes load as it opens (#323): offline, a Song never opened has none.
  test("says so in Song Creator when a Song's notes don't load, and Try again loads them", async ({
    page,
    context
  }) => {
    await context.route('**/catalog/notes/**', route =>
      route.fulfill({ status: 500, body: 'down' })
    )
    await page.goto('/compose/mary/')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Mary Had a Little Lamb' })
    ).toBeVisible()
    await expect(page.getByText("Couldn't load this Song.")).toBeVisible()

    await context.unroute('**/catalog/notes/**')
    await page.getByRole('button', { name: 'Try again' }).click()
    // No Recordings yet, so the Song it loaded is locked.
    await expect(page.getByText('This Song is locked.')).toBeVisible()
  })
})

/**
 * A control a thumb can hit: at least 44 by 44 CSS pixels, as the iPhone's controls, less 0.01 px
 * of the layout's float rounding.
 */
/** Taps low on the screen, beside the open menu, over the Songs. */
async function tapOutside(page: Page) {
  const height = page.viewportSize()?.height ?? 0
  await page.touchscreen.tap(8, height - 60)
}

async function expectTappable(control: Locator) {
  const box = await control.boundingBox()
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(43.99)
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.99)
}
