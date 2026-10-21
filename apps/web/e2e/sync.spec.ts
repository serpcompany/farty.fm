import { writeFileSync } from 'node:fs'
import { type BrowserContext, expect, type Page, test } from '@playwright/test'
import { songs } from '../src/lib/catalog/songs.generated'
import { newEmail, signInByApi } from './account'
import { recordAndSave, withFakeMicrophone } from './record'

// One account in two browsers (#156), at phone size on the Staging build, which has the Fixture
// Library to unlock Songs. Each browser plays the Recording and the Toot the other made, with the
// WAV the other uploaded, byte for byte, and a rename or delete in one shows in the other. A
// guest's Recording joins the account numbered after the account's.

const g3 = '090__carlosramon__17-pet__186119.wav'
withFakeMicrophone(g3)

declare global {
  interface Window {
    /** Each sound the page starts: its length and loudest sample. */
    __sounds: { duration: number; peak: number }[]
    /** Each promise rejection nothing handled. */
    __unhandled: string[]
  }
}

test.skip(({ isMobile }) => !isMobile, 'Sync is checked at phone size')

test.beforeEach(async ({ request }) => {
  const onStagingBuild =
    process.env.E2E_SERVER === 'preview' &&
    (await request.get('/fixtures/recordings/index.json')).ok()
  test.skip(
    !onStagingBuild,
    'The Fixture Library is only in the Staging build (pnpm build:staging)'
  )
})

// A service worker would answer navigations itself, without the Staging gate's credentials.
test.use({ serviceWorkers: 'block' })

const mary = song('mary')
const twinkle = song('twinkle')

test("two browsers signed in to one account play each other's farts, and see each other's deletes", async ({
  context,
  browser,
  baseURL,
  httpCredentials,
  viewport,
  userAgent,
  deviceScaleFactor,
  isMobile,
  hasTouch
}, testInfo) => {
  test.setTimeout(300_000)
  const email = newEmail(testInfo, 'sync')
  const other = await browser.newContext({
    baseURL,
    httpCredentials,
    viewport,
    userAgent,
    deviceScaleFactor,
    isMobile,
    hasTouch,
    serviceWorkers: 'block'
  })
  for (const browserContext of [context, other]) await listenToThePage(browserContext)
  const a = await context.newPage()
  const b = await other.newPage()
  let recordings = 0
  /** What each browser played of the other's: its length, peak and WAV. */
  const heard: Record<string, unknown> = {}

  await test.step('A signs in, loads the Fixture Library, makes a Toot, and uploads them', async () => {
    await a.goto('/profile/')
    await signInByApi(a, email)
    await a.goto('/profile/')
    await expect(a.getByTestId('account-email')).toHaveText(email)
    const library = a.getByTestId('fixture-library')
    await library.getByRole('button', { name: 'Load the Fixture Library' }).click()
    await expect(library.getByRole('button', { name: 'Fixture Library loaded' })).toBeDisabled({
      timeout: 90_000
    })
    recordings = Number(
      (await a.getByTestId('fixture-library-count').textContent())?.split(' of ')[1]
    )
    expect(recordings).toBeGreaterThan(0)
    await makeAToot(a, mary.id)
    await uploaded(a)
  })

  await test.step("B signs in to the same account, and plays A's Recording and Toot", async () => {
    await b.goto('/profile/')
    await signInByApi(b, email)
    await b.goto('/recordings/')
    await expect(b.getByTestId('recording-row')).toHaveCount(recordings)
    await b.getByRole('button', { name: /^Recording 1, / }).click()
    const sound = await lastStart(b)
    expect(sound.duration).toBeGreaterThan(0.1)
    expect(sound.peak).toBeGreaterThan(0.05)
    const recording = await wav(b, 'audio', 'Recording 1')
    expect(recording).toBe(await wav(a, 'audio', 'Recording 1'))
    heard["B, A's Recording 1"] = { ...sound, wav: recording }

    await tab(b, 'Toots').click()
    await b.getByRole('button', { name: `Play ${mary.title}` }).click()
    const toot = await lastStart(b)
    expect(toot.duration).toBeGreaterThan(5)
    expect(toot.peak).toBeGreaterThan(0.05)
    const tootWav = await wav(b, 'tootAudio', mary.title)
    expect(tootWav).toBe(await wav(a, 'tootAudio', mary.title))
    heard[`B, A's Toot ${mary.title}`] = { ...toot, wav: tootWav }
    await b.getByRole('button', { name: `Stop ${mary.title}` }).click()
  })

  const recorded = `Recording ${recordings + 1}`

  await test.step('B records a fart and makes a Toot, which A plays once it opens again', async () => {
    await recordAndSave(b, 1.5)
    await expect(b.getByTestId('result-note')).toHaveText('G3')
    await b.getByRole('button', { name: 'Done' }).click()
    await expect(b.getByRole('button', { name: new RegExp(`^${recorded}, `) })).toBeVisible()
    await makeAToot(b, twinkle.id)
    await uploaded(b)

    await a.goto('/recordings/')
    await expect(a.getByTestId('recording-row')).toHaveCount(recordings + 1)
    await a.getByRole('button', { name: new RegExp(`^${recorded}, \\d+\\.\\d s, G3$`) }).click()
    const sound = await lastStart(a)
    expect(sound.duration).toBeGreaterThan(1)
    expect(sound.peak).toBeGreaterThan(0.05)
    const recording = await wav(a, 'audio', recorded)
    expect(recording).toBe(await wav(b, 'audio', recorded))
    heard[`A, B's ${recorded}`] = { ...sound, wav: recording }

    await tab(a, 'Toots').click()
    await expect(a.getByTestId('toot-row')).toHaveCount(2)
    await a.getByRole('button', { name: `Play ${twinkle.title}` }).click()
    const toot = await lastStart(a)
    expect(toot.duration).toBeGreaterThan(5)
    expect(toot.peak).toBeGreaterThan(0.05)
    const tootWav = await wav(a, 'tootAudio', twinkle.title)
    expect(tootWav).toBe(await wav(b, 'tootAudio', twinkle.title))
    heard[`A, B's Toot ${twinkle.title}`] = { ...toot, wav: tootWav }
    await a.getByRole('button', { name: `Stop ${twinkle.title}` }).click()
  })

  await test.step("A deletes B's Toot, and it's gone from B once B comes back to Pedos", async () => {
    await tab(b, 'Toots').click()
    await expect(b.getByTestId('toot-row')).toHaveCount(2)
    await a.getByRole('button', { name: `More for ${twinkle.title}` }).click()
    await a.getByRole('menuitem', { name: 'Delete' }).click()
    await a
      .getByRole('alertdialog', { name: `Delete ${twinkle.title}?` })
      .getByRole('button', { name: 'Delete Toot' })
      .click()
    await expect(a.getByTestId('toot-row')).toHaveCount(1)
    await uploaded(a)

    // Back in Pedos, which opens on Record, without a reload.
    await comeBack(b)
    await expect(b).toHaveURL(/:\d+\/$/)
    await tab(b, 'Toots').click()
    await expect(b.getByTestId('toot-row')).toHaveCount(1)
    await expect(b.getByRole('button', { name: `Play ${mary.title}` })).toBeVisible()
    expect(await stored(b, 'toots')).toBe(1)
  })

  await test.step('A renames a Toot, and B shows the new name once it comes back, without a reload', async () => {
    const renamed = 'Lamb, from A'
    await a.getByRole('button', { name: `More for ${mary.title}` }).click()
    await a.getByRole('menuitem', { name: 'Rename' }).click()
    const dialog = a.getByRole('alertdialog', { name: 'Rename' })
    await dialog.getByRole('textbox', { name: 'Name' }).fill(renamed)
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(a.getByRole('button', { name: `Play ${renamed}` })).toBeVisible()
    await uploaded(a)

    await comeBack(b)
    await expect(b).toHaveURL(/:\d+\/$/)
    await tab(b, 'Toots').click()
    await expect(b.getByRole('button', { name: `Play ${renamed}` })).toBeVisible()
    await expect(b.getByTestId('toot-row')).toHaveCount(1)
  })

  await test.step("B deletes A's Recording, and it's gone from A once A comes back, and after a reload", async () => {
    await tab(b, 'Recordings').click()
    await tab(a, 'Recordings').click()
    await b.getByRole('button', { name: 'Delete Recording 1', exact: true }).click()
    await b.getByRole('alertdialog').getByRole('button', { name: 'Delete Recording' }).click()
    await expect(b.getByTestId('recording-row')).toHaveCount(recordings)
    await uploaded(b)

    await comeBack(a)
    await expect(a).toHaveURL(/:\d+\/$/)
    await tab(a, 'Recordings').click()
    await expect(a.getByTestId('recording-row')).toHaveCount(recordings)
    await expect(a.getByRole('button', { name: /^Recording 1, / })).toHaveCount(0)
    await a.reload()
    await expect(a.getByTestId('recording-row')).toHaveCount(recordings)
    expect(await stored(a, 'recordings')).toBe(recordings)
    await a.screenshot({ path: testInfo.outputPath('a-recordings.png') })
  })

  // The evidence for the PR: what was heard, with its WAV's size and SHA-256.
  writeFileSync(testInfo.outputPath('heard.json'), JSON.stringify(heard, null, 2))
  expect(await a.evaluate(() => window.__unhandled)).toEqual([])
  expect(await b.evaluate(() => window.__unhandled)).toEqual([])
  await other.close()
})

test("a guest's Recording joins the account numbered after the account's, in both browsers", async ({
  context,
  browser,
  baseURL,
  httpCredentials,
  viewport,
  userAgent,
  deviceScaleFactor,
  isMobile,
  hasTouch
}, testInfo) => {
  test.setTimeout(180_000)
  const email = newEmail(testInfo, 'numbers')
  const other = await browser.newContext({
    baseURL,
    httpCredentials,
    viewport,
    userAgent,
    deviceScaleFactor,
    isMobile,
    hasTouch,
    serviceWorkers: 'block'
  })
  for (const browserContext of [context, other]) await listenToThePage(browserContext)
  const a = await context.newPage()
  const b = await other.newPage()
  const row = (page: Page, n: number) =>
    page.getByRole('button', { name: new RegExp(`^Recording ${n}, `) })

  await test.step('A signs in and records Recording 1', async () => {
    await a.goto('/')
    await signInByApi(a, email)
    await recordAndSave(a, 1.5)
    await a.getByRole('button', { name: 'Done' }).click()
    await expect(row(a, 1)).toBeVisible()
    await uploaded(a)
  })

  await test.step('B records as a guest, its own Recording 1, then signs in to the account', async () => {
    await recordAndSave(b, 1.5)
    await b.getByRole('button', { name: 'Done' }).click()
    await expect(row(b, 1)).toBeVisible()
    await signInByApi(b, email)
    await b.reload()
    await expect(b.getByTestId('recording-row')).toHaveCount(2)
    await expect(row(b, 1)).toHaveCount(1)
    await expect(row(b, 2)).toHaveCount(1)
    await uploaded(b)
    await b.screenshot({ path: testInfo.outputPath('b-numbers.png') })
  })

  await test.step('A shows the two Recordings, numbered 1 and 2', async () => {
    await comeBack(a)
    await tab(a, 'Recordings').click()
    await expect(a.getByTestId('recording-row')).toHaveCount(2)
    await expect(row(a, 1)).toHaveCount(1)
    await expect(row(a, 2)).toHaveCount(1)
    await a.reload()
    await expect(row(a, 1)).toHaveCount(1)
    await expect(row(a, 2)).toHaveCount(1)
  })

  expect(await a.evaluate(() => window.__unhandled)).toEqual([])
  expect(await b.evaluate(() => window.__unhandled)).toEqual([])
  await other.close()
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

/** Skips the Welcome and the account step, and records each sound the page starts. */
async function listenToThePage(context: BrowserContext) {
  await context.addInitScript(() => {
    localStorage.setItem('pedos.welcomed', '1')
    localStorage.setItem('pedos.accountStep', 'done')
    window.__sounds = []
    const start = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...args) {
      let peak = 0
      for (const sample of this.buffer?.getChannelData(0) ?? [])
        peak = Math.max(peak, Math.abs(sample))
      window.__sounds.push({ duration: this.buffer?.duration ?? 0, peak })
      return start.apply(this, args)
    }
    window.__unhandled = []
    window.addEventListener('unhandledrejection', event =>
      window.__unhandled.push(String(event.reason))
    )
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
  await expect.poll(() => page.evaluate(() => window.__sounds.length)).toBeGreaterThan(0)
  return page.evaluate(() => {
    const sound = window.__sounds[window.__sounds.length - 1]
    window.__sounds = []
    return sound
  })
}

/** Waits until this browser's outbox is empty: everything it changed is in the account. */
async function uploaded(page: Page) {
  await expect.poll(() => stored(page, 'outbox'), { timeout: 60_000 }).toBe(0)
}

/**
 * Fakes the page going to the background and coming back, as a phone switching apps does. Pedos
 * comes back on Record (`app-shell.tsx`), and syncs.
 */
async function comeBack(page: Page) {
  await page.evaluate(() => {
    for (const state of ['hidden', 'visible']) {
      Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    }
  })
}

/** How many entries one store of the `pedos` database holds. */
function stored(page: Page, store: string): Promise<number> {
  return page.evaluate(async store => {
    const db = await open()
    const count = await new Promise<number>((resolve, reject) => {
      const request = db.transaction(store).objectStore(store).count()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return count

    function open() {
      return new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('pedos')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    }
  }, store)
}

/**
 * The SHA-256 of the WAV this browser keeps for a Recording ("Recording 7") or a Toot (its title),
 * with its byte count.
 */
function wav(page: Page, store: 'audio' | 'tootAudio', name: string): Promise<string> {
  return page.evaluate(
    async ({ store, name }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('pedos')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const all = <T>(from: string) =>
        new Promise<T[]>((resolve, reject) => {
          const request = db.transaction(from).objectStore(from).getAll()
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
      const items =
        store === 'audio'
          ? (await all<{ id: string; number: number }>('recordings')).map(r => ({
              id: r.id,
              name: `Recording ${r.number}`
            }))
          : (await all<{ id: string; title: string }>('toots')).map(t => ({
              id: t.id,
              name: t.title
            }))
      const id = items.find(item => item.name === name)?.id
      const audio = await new Promise<ArrayBuffer | undefined>((resolve, reject) => {
        if (!id) return resolve(undefined)
        const request = db.transaction(store).objectStore(store).get(id)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      db.close()
      if (!audio) return `no audio for ${name}`
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', audio))
      const hex = [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('')
      return `${audio.byteLength} bytes, ${hex}`
    },
    { store, name }
  )
}
