import type { BrowserContext, Page } from '@playwright/test'
import { songs } from '../src/lib/catalog/songs.generated'
import { newEmail, signInByApi } from './account'
import { all, keys } from './database'
import { expectAtLeast44High, expectTappable, literally, tab } from './screens'
import { controlledByTheServiceWorker, errorsWhileOffline } from './service-worker'
import {
  loadTheFixtureLibrary,
  makeAToot,
  needsTheFixtureLibrary,
  song,
  songsTheFixturesUnlock
} from './songs'
import { lastSound, stops } from './sounds'
import { expect, test } from './test'
import { listenToTheToots, tootOf } from './toots'

needsTheFixtureLibrary()
test.use({ serviceWorkers: 'block' })

const mary = song('mary')
const twinkle = song('twinkle')

function countDecodesAndBacks(): void {
  const counted = window as unknown as { fartyDecodes: number; fartyBacks: number }
  counted.fartyDecodes = 0
  const decode = BaseAudioContext.prototype.decodeAudioData
  BaseAudioContext.prototype.decodeAudioData = function (
    this: BaseAudioContext,
    ...args: Parameters<BaseAudioContext['decodeAudioData']>
  ) {
    counted.fartyDecodes += 1
    return decode.apply(this, args)
  }
  counted.fartyBacks = 0
  const back = History.prototype.back
  History.prototype.back = function (this: History) {
    counted.fartyBacks += 1
    back.call(this)
  }
}

function counts(page: Page): Promise<{ fartyDecodes: number; fartyBacks: number }> {
  return page.evaluate(() => {
    const { fartyDecodes, fartyBacks } = window as unknown as {
      fartyDecodes: number
      fartyBacks: number
    }
    return { fartyDecodes, fartyBacks }
  })
}

async function expectTheFixtureLibraryOnProfile(page: Page, recordings: string) {
  await expect(page.getByTestId('stat-recordings')).toHaveText(`Recordings${recordings}`)
  await expect(page.getByTestId('stat-songs')).toHaveText(
    `Songs unlocked${songsTheFixturesUnlock.length} of ${songs.length}`
  )
}

async function recordingUsedBy(page: Page, songId: string): Promise<string> {
  const toot = await tootOf(page, songId)
  const id = Object.values(toot.arrangement.recordingForPitch)[0]
  const recording = (await all<{ id: string; number: number }>(page, 'recordings')).find(
    r => r.id === id
  )
  if (!recording) throw new Error(`No Recording used by the Toot of ${songId}`)
  return `Recording ${recording.number}`
}

test('Toots are kept: made, found after a relaunch, renamed, and deleted', async ({
  playwright,
  headless,
  projectOptions,
  pageErrors
}, testInfo) => {
  test.setTimeout(300_000)
  const profile = testInfo.outputPath('profile')
  const launch = async (): Promise<BrowserContext> => {
    const context = await playwright.chromium.launchPersistentContext(profile, {
      headless,
      ...projectOptions,
      serviceWorkers: 'block'
    })
    pageErrors.watch(context)
    await listenToTheToots(context)
    await context.addInitScript(countDecodesAndBacks)
    return context
  }

  let context = await launch()
  let page = context.pages()[0] ?? (await context.newPage())
  let recordings = ''

  await test.step("signed in, so the Toots outlast a relaunch: a guest's last only the visit", async () => {
    await page.goto('/profile/')
    await signInByApi(page, newEmail(testInfo, 'toots'))
  })

  await test.step('a new Profile: no stats yet, the Songs credit, the version and the pages', async () => {
    await page.goto('/profile/')
    await expect(page.getByTestId('stat-recordings')).toHaveText('Recordings0')
    await expect(page.getByTestId('stat-melodic')).toHaveText('Melodic Recordings0')
    await expect(page.getByTestId('stat-notes')).toHaveText('Notes collected0')
    await expect(page.getByTestId('stat-songs')).toHaveText(`Songs unlocked0 of ${songs.length}`)
    await expect(page.getByTestId('stat-toots')).toHaveText('Toots0')
    await expect(page.getByTestId('profile-new-user')).toHaveText(
      'Record your first fart on the Record tab. Collect notes to unlock Songs.'
    )
    await expect(page.getByTestId('songs-credit')).toHaveText(
      'SongsFrom public-domain scores in PDMX'
    )
    await expect(page.getByTestId('app-version')).toHaveText(/^Version\d+\.\d+\.\d+$/)
    for (const name of ['Privacy', 'Support']) {
      const link = page.getByRole('link', { name, exact: true })
      await expectTappable(link)
      await link.click()
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
      await page.goBack()
    }
    await expect(page.getByTestId('stat-recordings')).toBeVisible()
  })

  await test.step('the Fixture Library fills the stats, and 8 of the 12 Songs unlock', async () => {
    await loadTheFixtureLibrary(page)
    const total = await page.getByTestId('fixture-library-count').textContent()
    recordings = total?.split(' of ')[1] ?? ''
    expect(Number(recordings)).toBeGreaterThan(0)
    await expectTheFixtureLibraryOnProfile(page, recordings)
    await expect(page.getByTestId('profile-new-user')).toHaveCount(0)
    await tab(page, 'Recordings').click()
    const summary = await page.getByTestId('pitch-summary').textContent()
    const [, melodic, notes] =
      summary?.match(/^(\d+) Melodic Recordings? across (\d+) notes?/) ?? []
    expect(Number(melodic)).toBeGreaterThan(0)
    await tab(page, 'Profile').click()
    await expect(page.getByTestId('stat-melodic')).toHaveText(`Melodic Recordings${melodic}`)
    await expect(page.getByTestId('stat-notes')).toHaveText(`Notes collected${notes}`)
    for (const row of await page.getByRole('main').locator('ul > li').all()) {
      await expectAtLeast44High(row)
    }
  })

  await test.step('two Toots, made in Song Creator and saved', async () => {
    for (const made of [mary, twinkle]) await makeAToot(page, made.id)
    await tab(page, 'Profile').click()
    await expect(page.getByTestId('stat-toots')).toHaveText('Toots2')
  })

  await test.step('the Toots tab lists them newest first, and a row plays its Toot', async () => {
    await tab(page, 'Toots').click()
    const rows = page.getByTestId('toot-row')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0).getByRole('link')).toHaveText(
      new RegExp(`^${literally(twinkle.title)}${literally(twinkle.title)} · Today · \\d:\\d\\d$`)
    )
    await expect(rows.nth(1).getByTestId('toot-details')).toHaveText(
      new RegExp(`^${literally(mary.title)} · Today · \\d:\\d\\d$`)
    )
    for (const row of await rows.all()) {
      for (const control of [
        row.getByRole('button', { name: /^Play / }),
        row.getByRole('link'),
        row.getByRole('button', { name: /^More for / })
      ]) {
        await expectTappable(control)
      }
    }

    await page.getByRole('button', { name: `Play ${mary.title}` }).click()
    const whole = await lastSound(page)
    expect(whole.duration).toBeGreaterThan(5)
    expect(whole.peak).toBeGreaterThan(0.05)
    await page.getByRole('button', { name: `Stop ${mary.title}` }).click()
    await expect(page.getByRole('button', { name: `Play ${mary.title}` })).toBeVisible()
  })

  await test.step("a Toot's screen is Song Creator's without Save", async () => {
    await page.getByTestId('toot-row').nth(1).getByRole('link').click()
    await expect(page).toHaveURL(/\/toots\/toot\/\?id=[\w-]+$/)
    await expect(page.getByRole('heading', { level: 1, name: mary.title })).toBeVisible()
    await expect(page.getByText(mary.source)).toBeVisible()
    await expect(page.getByRole('button', { name: /Save to Toots/ })).toHaveCount(0)
    const state = page.getByTestId('song-creator-state')
    await expect(state).toHaveText('Ready')
    for (const control of [
      page.getByRole('link', { name: 'Back to Toots' }),
      page.getByTestId('song-creator-play'),
      page.getByRole('button', { name: `More for ${mary.title}` }),
      page.getByTestId('note-view')
    ]) {
      await expectTappable(control)
    }
    await page.getByTestId('song-creator-play').click()
    await expect(state).toHaveText('Playing')
    expect((await lastSound(page)).duration).toBeGreaterThan(5)

    await page.getByRole('link', { name: 'Back to Toots' }).click()
    await expect(page).toHaveURL(/\/toots\/$/)
    await expect(page.getByRole('button', { name: `Play ${mary.title}` })).toBeVisible()
  })

  await test.step('Rename, from the row', async () => {
    await page.getByRole('button', { name: `More for ${mary.title}` }).click()
    const rename = page.getByRole('menuitem', { name: 'Rename' })
    await expectTappable(rename)
    await expectTappable(page.getByRole('menuitem', { name: 'Delete' }))
    await rename.click()
    const dialog = page.getByRole('alertdialog', { name: 'Rename' })
    const name = dialog.getByRole('textbox', { name: 'Name' })
    await expect(name).toHaveValue(mary.title)
    for (const control of [
      name,
      dialog.getByRole('button', { name: 'Cancel' }),
      dialog.getByRole('button', { name: 'Save' })
    ]) {
      await expectTappable(control)
    }
    await name.fill('  Lamb, in farts  ')
    await name.press('Enter')
    await expect(dialog).toBeHidden()
    const renamed = page.getByTestId('toot-row').nth(1).getByRole('link')
    await expect(renamed).toHaveText(new RegExp(`^Lamb, in farts${literally(mary.title)} · Today`))

    await page.getByRole('button', { name: 'More for Lamb, in farts' }).click()
    await page.getByRole('menuitem', { name: 'Rename' }).click()
    await name.fill('   ')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()
    await expect(renamed).toHaveText(new RegExp(`^Lamb, in farts${literally(mary.title)} · Today`))
  })

  await test.step('quit, open Farty again, and the Toots and Recordings are there', async () => {
    await context.close()
    context = await launch()
    page = context.pages()[0] ?? (await context.newPage())
    await page.goto('/toots/')
    const rows = page.getByTestId('toot-row')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0).getByRole('link')).toContainText(twinkle.title)
    await expect(rows.nth(1).getByRole('link')).toContainText('Lamb, in farts')
    expect((await all<{ title: string }>(page, 'toots')).map(t => t.title).sort()).toEqual([
      'Lamb, in farts',
      twinkle.title
    ])
    await tab(page, 'Profile').click()
    await expect(page.getByTestId('stat-toots')).toHaveText('Toots2')
    await expectTheFixtureLibraryOnProfile(page, recordings)
  })

  await test.step('a Toot still plays after a Recording it used is deleted', async () => {
    const used = await recordingUsedBy(page, mary.id)
    await tab(page, 'Recordings').click()
    await page.getByRole('button', { name: `Delete ${used}`, exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete Recording' }).click()
    await expect(page.getByRole('button', { name: new RegExp(`^${used},`) })).toHaveCount(0)

    await tab(page, 'Toots').click()
    await page.getByRole('link', { name: /^Lamb, in farts/ }).click()
    await expect(page.getByText('Recording deleted').first()).toBeVisible()
    await page.getByTestId('song-creator-play').click()
    await expect(page.getByTestId('song-creator-state')).toHaveText('Playing')
    const whole = await lastSound(page)
    expect(whole.duration).toBeGreaterThan(5)
    expect(whole.peak).toBeGreaterThan(0.05)
  })

  await test.step('Delete, from the row, while it plays: it stops, and the others keep their audio', async () => {
    await page.getByRole('link', { name: 'Back to Toots' }).click()
    await expect(page).toHaveURL(/\/toots\/$/)
    await page.getByRole('button', { name: 'Play Lamb, in farts' }).click()
    await lastSound(page)
    await page.getByRole('button', { name: `Play ${twinkle.title}` }).click()
    expect((await lastSound(page)).duration).toBeGreaterThan(5)
    const { fartyDecodes: decodes } = await counts(page)
    const stopsBefore = await stops(page)

    await expect(page.getByRole('button', { name: `Stop ${twinkle.title}` })).toBeVisible()
    await page.getByRole('button', { name: `More for ${twinkle.title}` }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await page
      .getByRole('alertdialog', { name: `Delete ${twinkle.title}?` })
      .getByRole('button', { name: 'Delete Toot' })
      .click()
    await expect(page.getByTestId('toot-row')).toHaveCount(1)
    await expect.poll(() => stops(page)).toBe(stopsBefore + 1)

    await page.getByRole('button', { name: 'Play Lamb, in farts' }).click()
    expect((await lastSound(page)).duration).toBeGreaterThan(5)
    expect((await counts(page)).fartyDecodes).toBe(decodes)
    await page.getByRole('button', { name: 'Stop Lamb, in farts' }).click()
  })

  await test.step("Delete, from a Toot's screen: one tap's worth, back to the list, which is empty", async () => {
    await page.getByRole('link', { name: /^Lamb, in farts/ }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Lamb, in farts' })).toBeVisible()
    await page.getByRole('button', { name: 'More for Lamb, in farts' }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Delete Lamb, in farts?' })
    await expect(dialog).toContainText("This can't be undone.")
    const confirm = dialog.getByRole('button', { name: 'Delete Toot' })
    await expectTappable(confirm)
    await expectTappable(dialog.getByRole('button', { name: 'Cancel' }))
    const { fartyBacks: backs } = await counts(page)
    await confirm.evaluate(button => {
      ;(button as HTMLButtonElement).click()
      ;(button as HTMLButtonElement).click()
    })
    await expect(page).toHaveURL(/\/toots\/$/)
    expect((await counts(page)).fartyBacks).toBe(backs + 1)
    await expect(page.getByText('Nothing yet')).toBeVisible()
    await expect(page.getByText('Make one in Compose.')).toBeVisible()
    expect(await all(page, 'toots')).toEqual([])
    expect(await keys(page, 'tootAudio')).toEqual([])
    await tab(page, 'Profile').click()
    await expect(page.getByTestId('stat-toots')).toHaveText('Toots0')
  })

  await context.close()
})

test.describe('installed', () => {
  test.use({ serviceWorkers: 'allow' })

  test('the installed app opens a Toot offline, and plays it', async ({
    page,
    context,
    pageErrors
  }, testInfo) => {
    test.setTimeout(180_000)
    pageErrors.expect(...errorsWhileOffline)
    await listenToTheToots(context)
    await page.goto('/profile/')
    await signInByApi(page, newEmail(testInfo, 'offline'))
    await page.reload()
    await controlledByTheServiceWorker(page)
    await loadTheFixtureLibrary(page)
    await makeAToot(page, mary.id)

    await context.setOffline(true)
    await tab(page, 'Toots').click()
    await page.getByRole('link', { name: new RegExp(`^${literally(mary.title)}`) }).click()
    await expect(page).toHaveURL(/\/toots\/toot\/\?id=[\w-]+$/)
    await expect(page.getByRole('heading', { level: 1, name: mary.title })).toBeVisible()
    await page.getByTestId('song-creator-play').click()
    await expect(page.getByTestId('song-creator-state')).toHaveText('Playing')
    expect((await lastSound(page)).duration).toBeGreaterThan(5)
    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: mary.title })).toBeVisible()
    await context.setOffline(false)
  })
})
