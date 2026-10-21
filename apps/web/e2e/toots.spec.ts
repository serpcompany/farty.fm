import { type BrowserContext, expect, type Locator, type Page, test } from '@playwright/test'
import { songs } from '../src/lib/catalog/songs.generated'

// The Toots tab, a Toot's screen and Profile, on the Staging build with the Fixture Library
// loaded, so every Song is unlocked. The first test is the owner's check on a phone: make Toots,
// quit, open Pedos again and find them, then rename, delete a Recording a Toot uses, and delete
// the Toots. Then a Toot whose audio is gone, Toots that fail to load, an unknown Toot, and a
// Toot opened offline.

declare global {
  interface Window {
    /** Each sound the page starts: its length, loudest sample and `start` arguments. */
    __starts: { duration: number; peak: number; args: number[] }[]
    /** How many times the page went back in its history. */
    __backs: number
    /** How many sounds the page stopped before they ended. */
    __stops: number
    /** How many times the page decoded audio. */
    __decodes: number
    /** Each promise rejection nothing handled. */
    __unhandled: string[]
    /** How many times the store broken by `breakTheStore` failed. */
    __broken: number
    /** Undoes `breakTheStore`. */
    __mendTheStore?: () => void
  }
}

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

// A relaunched profile's service worker answers navigations itself, and its requests then meet
// the Staging gate without the test's credentials. The offline test, at the end, has it.
test.use({ serviceWorkers: 'block' })

const mary = song('mary')
const twinkle = song('twinkle')

test('Toots are kept: made, found after a relaunch, renamed, and deleted', async ({
  playwright,
  headless,
  baseURL,
  httpCredentials,
  viewport,
  userAgent,
  deviceScaleFactor,
  isMobile,
  hasTouch
}, testInfo) => {
  test.setTimeout(300_000)
  const profile = testInfo.outputPath('profile')
  const launch = async (): Promise<BrowserContext> => {
    const context = await playwright.chromium.launchPersistentContext(profile, {
      headless,
      baseURL,
      httpCredentials,
      viewport,
      userAgent,
      deviceScaleFactor,
      isMobile,
      hasTouch,
      serviceWorkers: 'block'
    })
    await listenToThePage(context)
    return context
  }

  let context = await launch()
  let page = context.pages()[0] ?? (await context.newPage())
  /** How many Recordings the Fixture Library added. */
  let recordings = ''

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

  await test.step('the Fixture Library fills the stats, and every Song unlocks', async () => {
    await loadTheFixtureLibrary(page)
    const total = await page.getByTestId('fixture-library-count').textContent()
    recordings = total?.split(' of ')[1] ?? ''
    expect(Number(recordings)).toBeGreaterThan(0)
    await expect(page.getByTestId('stat-recordings')).toHaveText(`Recordings${recordings}`)
    await expect(page.getByTestId('stat-songs')).toHaveText(
      `Songs unlocked${songs.length} of ${songs.length}`
    )
    await expect(page.getByTestId('profile-new-user')).toHaveCount(0)
    // The same counts as the Recordings tab's.
    await tab(page, 'Recordings').click()
    const summary = await page.getByTestId('pitch-summary').textContent()
    const [, melodic, notes] =
      summary?.match(/^(\d+) Melodic Recordings? across (\d+) notes?/) ?? []
    expect(Number(melodic)).toBeGreaterThan(0)
    await tab(page, 'Profile').click()
    await expect(page.getByTestId('stat-melodic')).toHaveText(`Melodic Recordings${melodic}`)
    await expect(page.getByTestId('stat-notes')).toHaveText(`Notes collected${notes}`)
    for (const row of await page.getByRole('main').getByRole('listitem').all()) {
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

    // Its saved audio: the whole Toot, which isn't silence.
    await page.getByRole('button', { name: `Play ${mary.title}` }).click()
    const whole = await lastStart(page)
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
    expect((await lastStart(page)).duration).toBeGreaterThan(5)

    // Back goes back to the list, and stops the sound.
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
    // The name is trimmed.
    await name.fill('  Lamb, in farts  ')
    await name.press('Enter')
    await expect(dialog).toBeHidden()
    const renamed = page.getByTestId('toot-row').nth(1).getByRole('link')
    await expect(renamed).toHaveText(new RegExp(`^Lamb, in farts${literally(mary.title)} · Today`))

    // A name of only spaces changes nothing, here or in the store (checked after the relaunch).
    await page.getByRole('button', { name: 'More for Lamb, in farts' }).click()
    await page.getByRole('menuitem', { name: 'Rename' }).click()
    await name.fill('   ')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()
    await expect(renamed).toHaveText(new RegExp(`^Lamb, in farts${literally(mary.title)} · Today`))
  })

  await test.step('quit, open Pedos again, and the Toots and Recordings are there', async () => {
    await context.close()
    context = await launch()
    page = context.pages()[0] ?? (await context.newPage())
    await page.goto('/toots/')
    const rows = page.getByTestId('toot-row')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0).getByRole('link')).toContainText(twinkle.title)
    await expect(rows.nth(1).getByRole('link')).toContainText('Lamb, in farts')
    expect((await database(page)).toots.map(t => t.title).sort()).toEqual([
      'Lamb, in farts',
      twinkle.title
    ])
    await tab(page, 'Profile').click()
    await expect(page.getByTestId('stat-toots')).toHaveText('Toots2')
    await expect(page.getByTestId('stat-recordings')).toHaveText(`Recordings${recordings}`)
    await expect(page.getByTestId('stat-songs')).toHaveText(
      `Songs unlocked${songs.length} of ${songs.length}`
    )
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
    const whole = await lastStart(page)
    expect(whole.duration).toBeGreaterThan(5)
    expect(whole.peak).toBeGreaterThan(0.05)
  })

  await test.step('Delete, from the row, while it plays: it stops, and the others keep their audio', async () => {
    await page.getByRole('link', { name: 'Back to Toots' }).click()
    await expect(page).toHaveURL(/\/toots\/$/)
    // Each Toot decodes once, and starting the second stops the first.
    await page.getByRole('button', { name: 'Play Lamb, in farts' }).click()
    await lastStart(page)
    await page.getByRole('button', { name: `Play ${twinkle.title}` }).click()
    expect((await lastStart(page)).duration).toBeGreaterThan(5)
    const decodes = await page.evaluate(() => window.__decodes)
    await page.evaluate(() => (window.__stops = 0))

    await expect(page.getByRole('button', { name: `Stop ${twinkle.title}` })).toBeVisible()
    await page.getByRole('button', { name: `More for ${twinkle.title}` }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await page
      .getByRole('alertdialog', { name: `Delete ${twinkle.title}?` })
      .getByRole('button', { name: 'Delete Toot' })
      .click()
    await expect(page.getByTestId('toot-row')).toHaveCount(1)
    await expect.poll(() => page.evaluate(() => window.__stops)).toBe(1)

    // The Toot left plays from the audio it decoded before.
    await page.getByRole('button', { name: 'Play Lamb, in farts' }).click()
    expect((await lastStart(page)).duration).toBeGreaterThan(5)
    expect(await page.evaluate(() => window.__decodes)).toBe(decodes)
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
    // Two taps before the dialog closes go back once, not past the Toots tab.
    await page.evaluate(() => (window.__backs = 0))
    await confirm.evaluate(button => {
      ;(button as HTMLButtonElement).click()
      ;(button as HTMLButtonElement).click()
    })
    await expect(page).toHaveURL(/\/toots\/$/)
    expect(await page.evaluate(() => window.__backs)).toBe(1)
    await expect(page.getByText('Nothing yet')).toBeVisible()
    await expect(page.getByText('Make one in Compose.')).toBeVisible()
    // Each Toot went with its audio.
    const { toots, withAudio } = await database(page)
    expect(toots).toEqual([])
    expect(withAudio).toEqual([])
    await tab(page, 'Profile').click()
    await expect(page.getByTestId('stat-toots')).toHaveText('Toots0')
  })

  await context.close()
})

test("a Toot whose audio is gone says so, and can't play; one the store fails for a moment is kept", async ({
  page
}) => {
  test.setTimeout(180_000)
  await listenToThePage(page.context())
  await page.goto('/profile/')
  await loadTheFixtureLibrary(page)
  await makeAToot(page, mary.id)
  await makeAToot(page, twinkle.id)
  await tab(page, 'Toots').click()
  await expect(page.getByTestId('toot-row')).toHaveCount(2)
  const twinkleDetails = page.getByTestId('toot-row').nth(0).getByTestId('toot-details')

  // Audio that can't be read this time isn't missing: the play fails, and the next one plays.
  await breakTheStore(page, 'get', 'tootAudio')
  await page.getByRole('button', { name: `Play ${twinkle.title}` }).click()
  await expect(twinkleDetails).toHaveText(`${twinkle.title} · Couldn't play`)
  expect(await page.evaluate(() => window.__broken)).toBe(1)
  await page.getByRole('button', { name: `Play ${twinkle.title}` }).click()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await mendTheStore(page)
  await page.getByRole('button', { name: `Play ${twinkle.title}` }).click()
  expect((await lastStart(page)).duration).toBeGreaterThan(5)
  await expect(twinkleDetails).toHaveText(new RegExp(`^${literally(twinkle.title)} · Today`))
  await page.getByRole('button', { name: `Stop ${twinkle.title}` }).click()

  // And on its screen.
  await page.getByRole('link', { name: new RegExp(`^${literally(twinkle.title)}`) }).click()
  const state = page.getByTestId('song-creator-state')
  await expect(state).toHaveText('Ready')
  await breakTheStore(page, 'get', 'tootAudio')
  await page.getByTestId('song-creator-play').click()
  await expect(state).toHaveText("Couldn't play")
  await mendTheStore(page)
  await page.getByTestId('song-creator-play').click()
  await expect(state).toHaveText('Playing')
  await page.getByRole('link', { name: 'Back to Toots' }).click()
  expect((await database(page)).withAudio).toHaveLength(2)

  // A rename the store fails to save shows until a reload, and leaves nothing unhandled.
  await breakTheStore(page, 'put', 'toots')
  await page.getByRole('button', { name: `More for ${mary.title}` }).click()
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  await page.getByRole('alertdialog').getByRole('textbox', { name: 'Name' }).fill('Not kept')
  await page.getByRole('alertdialog').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('toot-row').nth(1).getByRole('link')).toContainText('Not kept')
  await expect.poll(() => page.evaluate(() => window.__broken)).toBe(1)
  // A rejection nothing handles is reported once its task ends.
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 500)))
  expect(await page.evaluate(() => window.__unhandled)).toEqual([])
  await mendTheStore(page)

  // Gone while the list shows: a tap finds out.
  await deleteTootAudio(page, twinkle.id)
  await page.getByRole('button', { name: `Play ${twinkle.title}` }).click()
  await expect(page.getByTestId('toot-row').nth(0).getByTestId('toot-details')).toHaveText(
    `${twinkle.title} · Audio missing`
  )

  // Gone when the Toots load. The rename that wasn't saved is gone too.
  await deleteTootAudio(page, mary.id)
  await page.reload()
  const row = page.getByTestId('toot-row').nth(1)
  await expect(row.getByRole('link')).toHaveText(`${mary.title}${mary.title} · Audio missing`)
  await page.evaluate(() => (window.__starts = []))
  const play = page.getByRole('button', { name: `${mary.title}: audio missing` })
  await expectTappable(play)
  await play.click()
  const alert = page.getByRole('alertdialog', { name: "This Toot's audio is missing" })
  await expect(alert).toContainText(
    "It can't be played. You can delete it and make it again in Compose."
  )
  await expectTappable(alert.getByRole('button', { name: 'Cancel' }))
  await expectTappable(alert.getByRole('button', { name: 'Delete' }))
  await alert.getByRole('button', { name: 'Cancel' }).click()
  await expect(alert).toBeHidden()

  // Its screen says what to do, and neither Play nor a note plays.
  await row.getByRole('link').click()
  await expect(page.getByTestId('toot-audio-missing')).toHaveText(
    "This Toot's audio is missing. You can delete it and make it again in Compose."
  )
  await expect(page.getByTestId('song-creator-state')).toHaveText('Audio missing')
  await expect(page.getByRole('button', { name: 'Audio missing' })).toBeDisabled()
  await page.getByTestId('note-view').click()
  await expect(page.getByTestId('note-caption')).toHaveCount(0)
  expect(await page.evaluate(() => window.__starts.length)).toBe(0)

  // The alert's Delete deletes it.
  await page.getByRole('link', { name: 'Back to Toots' }).click()
  await page.getByRole('button', { name: `${mary.title}: audio missing` }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByTestId('toot-row')).toHaveCount(1)
  const { toots, withAudio } = await database(page)
  expect(toots.map(t => t.songId)).toEqual([twinkle.id])
  expect(withAudio).toEqual([])
})

test("Toots that fail to load, and a Toot that isn't there, say so", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pedos.welcomed', '1')
    // Only loading the Toots reads every key of a store.
    IDBObjectStore.prototype.getAllKeys = () => {
      throw new DOMException('Broken for the test', 'UnknownError')
    }
  })
  await page.goto('/toots/')
  await expect(page.getByText("Couldn't load your Toots.")).toBeVisible()
  await page.goto('/toots/toot/?id=not-a-toot')
  await expect(page.getByText("Couldn't load your Toots.")).toBeVisible()

  const fresh = await page.context().newPage()
  await fresh.addInitScript(() => localStorage.setItem('pedos.welcomed', '1'))
  await fresh.goto('/toots/toot/?id=not-a-toot')
  await expect(fresh.getByText("Couldn't find this Toot.")).toBeVisible()
  // With no Toots tab before it, Back opens the Toots tab in its place.
  await fresh.getByRole('link', { name: 'Back to Toots' }).click()
  await expect(fresh).toHaveURL(/\/toots\/$/)
  await expect(fresh.getByText('Nothing yet')).toBeVisible()
})

test.describe('installed', () => {
  test.use({ serviceWorkers: 'allow' })

  test('the installed app opens a Toot offline, and plays it', async ({ page, context }) => {
    test.setTimeout(180_000)
    await listenToThePage(context)
    await page.goto('/profile/')
    await page.waitForFunction(async () => {
      await navigator.serviceWorker.ready
      return navigator.serviceWorker.controller !== null
    })
    await loadTheFixtureLibrary(page)
    await makeAToot(page, mary.id)

    await context.setOffline(true)
    await tab(page, 'Toots').click()
    await page.getByRole('link', { name: new RegExp(`^${literally(mary.title)}`) }).click()
    await expect(page).toHaveURL(/\/toots\/toot\/\?id=[\w-]+$/)
    await expect(page.getByRole('heading', { level: 1, name: mary.title })).toBeVisible()
    await page.getByTestId('song-creator-play').click()
    await expect(page.getByTestId('song-creator-state')).toHaveText('Playing')
    expect((await lastStart(page)).duration).toBeGreaterThan(5)
    // A reload, offline, opens the same Toot.
    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: mary.title })).toBeVisible()
    await context.setOffline(false)
  })
})

function song(id: string) {
  const found = songs.find(s => s.id === id)
  if (!found) throw new Error(`No Song ${id}`)
  return found
}

function tab(page: Page, label: string) {
  return page
    .getByRole('navigation', { name: 'Tabs' })
    .getByRole('link', { name: label, exact: true })
}

/**
 * Skips the Welcome, and records each sound the page starts (`__starts`) and stops (`__stops`),
 * each decode, each Back, and each promise rejection nothing handled.
 */
async function listenToThePage(context: BrowserContext) {
  await context.addInitScript(() => {
    localStorage.setItem('pedos.welcomed', '1')
    window.__starts = []
    const start = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...args) {
      let peak = 0
      for (const sample of this.buffer?.getChannelData(0) ?? [])
        peak = Math.max(peak, Math.abs(sample))
      window.__starts.push({ duration: this.buffer?.duration ?? 0, peak, args: args as number[] })
      return start.apply(this, args)
    }
    window.__stops = 0
    const stop = AudioBufferSourceNode.prototype.stop
    AudioBufferSourceNode.prototype.stop = function (this: AudioBufferSourceNode, ...args) {
      window.__stops += 1
      return stop.apply(this, args)
    }
    window.__decodes = 0
    const decode = BaseAudioContext.prototype.decodeAudioData
    BaseAudioContext.prototype.decodeAudioData = function (
      this: BaseAudioContext,
      ...args: Parameters<BaseAudioContext['decodeAudioData']>
    ) {
      window.__decodes += 1
      return decode.apply(this, args)
    }
    window.__unhandled = []
    window.addEventListener('unhandledrejection', event =>
      window.__unhandled.push(String(event.reason))
    )
    window.__backs = 0
    const back = History.prototype.back
    History.prototype.back = function (this: History) {
      window.__backs += 1
      back.call(this)
    }
  })
}

/** Loads the Fixture Library on Profile. */
async function loadTheFixtureLibrary(page: Page) {
  const library = page.getByTestId('fixture-library')
  await library.getByRole('button', { name: 'Load the Fixture Library' }).click()
  await expect(library.getByRole('button', { name: 'Fixture Library loaded' })).toBeDisabled({
    timeout: 90_000
  })
}

/** Opens a Song from Compose, waits for its Toot, saves it, and goes back to Compose. */
async function makeAToot(page: Page, songId: string) {
  await tab(page, 'Compose').click()
  await page
    .getByTestId('unlocked-songs')
    .locator(`[data-song="${songId}"]`)
    .getByRole('link')
    .click({ timeout: 60_000 })
  await expect(page.getByTestId('song-creator-state')).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: 'Save to Toots' }).click()
  await expect(page.getByRole('button', { name: 'Saved to Toots' })).toBeDisabled()
  await page.getByRole('link', { name: 'Back to Compose' }).click()
  await expect(page).toHaveURL(/\/compose\/$/)
}

/** The page's latest sound, once it has started one since the last call. */
async function lastStart(page: Page) {
  await expect.poll(() => page.evaluate(() => window.__starts.length)).toBeGreaterThan(0)
  return page.evaluate(() => {
    const start = window.__starts[window.__starts.length - 1]
    window.__starts = []
    return start
  })
}

/** What the `pedos` database holds: the Toots, which have audio, and the Recordings. */
function database(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('pedos')
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    const read = <R>(store: string, get: (store: IDBObjectStore) => IDBRequest<R>) =>
      new Promise<R>((resolve, reject) => {
        const r = get(db.transaction(store).objectStore(store))
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => reject(r.error)
      })
    const toots = await read<
      {
        id: string
        title: string
        songId: string
        arrangement: { recordingForPitch: Record<string, string> }
      }[]
    >('toots', store => store.getAll())
    const withAudio = await read('tootAudio', store => store.getAllKeys())
    const recordings = await read<{ id: string; number: number }[]>('recordings', store =>
      store.getAll()
    )
    db.close()
    return { toots, withAudio: withAudio.map(String), recordings }
  })
}

/** The name of a Recording that the Toot of a Song uses ("Recording 7"). */
async function recordingUsedBy(page: Page, songId: string): Promise<string> {
  const { toots, recordings } = await database(page)
  const toot = toots.find(t => t.songId === songId)
  const id = Object.values(toot?.arrangement.recordingForPitch ?? {})[0]
  const recording = recordings.find(r => r.id === id)
  if (!recording) throw new Error(`No Recording used by the Toot of ${songId}`)
  return `Recording ${recording.number}`
}

/** Deletes the audio of the Toot of a Song, as if the browser had lost it. */
async function deleteTootAudio(page: Page, songId: string): Promise<void> {
  const { toots } = await database(page)
  const id = toots.find(t => t.songId === songId)?.id
  if (!id) throw new Error(`No Toot of ${songId}`)
  await page.evaluate(async id => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('pedos')
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    await new Promise((resolve, reject) => {
      const r = db.transaction('tootAudio', 'readwrite').objectStore('tootAudio').delete(id)
      r.onsuccess = resolve
      r.onerror = () => reject(r.error)
    })
    db.close()
  }, id)
}

/**
 * Breaks one method of one store for a moment, until `mendTheStore`: a read (`get`) throws, as a
 * closing database does, and a write (`put`) aborts its transaction, as a full disk does.
 */
async function breakTheStore(page: Page, method: 'get' | 'put', store: string) {
  await page.evaluate(
    ({ method, store }) => {
      window.__broken = 0
      type Method = (this: IDBObjectStore, ...args: unknown[]) => IDBRequest
      const prototype = IDBObjectStore.prototype as unknown as Record<typeof method, Method>
      const original = prototype[method]
      prototype[method] = function (...args) {
        if (this.name !== store) return original.apply(this, args)
        window.__broken += 1
        if (method === 'get') throw new DOMException('Broken for the test', 'UnknownError')
        const request = original.apply(this, args)
        this.transaction.abort()
        return request
      }
      window.__mendTheStore = () => {
        prototype[method] = original
      }
    },
    { method, store }
  )
}

async function mendTheStore(page: Page) {
  await page.evaluate(() => window.__mendTheStore?.())
}

/** A title or other copy, matched as written inside a pattern. */
function literally(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * A control a thumb can hit: at least 44 by 44 CSS pixels, as the iPhone's controls. Measured once
 * a menu or dialog has opened: it zooms in from 95%.
 */
async function expectTappable(control: Locator) {
  await settled(control)
  const box = await control.boundingBox()
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
}

/** A row a thumb can hit across its width: at least 44 CSS pixels high. */
async function expectAtLeast44High(row: Locator) {
  const box = await row.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
}

/** Waits for `on` to show, then for the page's animations that end, such as a dialog's zoom. */
async function settled(on: Locator) {
  await on.waitFor()
  await on.page().evaluate(async () => {
    // An animation starts on the frame after its element shows.
    for (let frame = 0; frame < 2; frame++) await new Promise(requestAnimationFrame)
    await Promise.all(
      document
        .getAnimations()
        .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => {}))
    )
  })
}
