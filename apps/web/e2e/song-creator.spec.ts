import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { songs } from '../src/lib/catalog/songs.generated'

// Song Creator on the Staging build, with the whole Fixture Library loaded: every Song is
// unlocked. Each Song opens from Compose, is made and starts playing, plays one tapped note, and
// is saved; the Toots are then read back from IndexedDB. Then a direct load, a failed render, a
// locked and an unknown Song, and a Song opened offline.
//
// With E2E_EVIDENCE_DIR set, the test also writes each Toot's WAV, the time each took to make,
// and screenshots there, for `evaluate_renders.py` and the PR.

/** Every start of an `AudioBufferSourceNode`, as the page's init script records it. */
type Start = { duration: number; peak: number; args: number[] }

/** When the latest tap was, and when Song Creator showed "Making your Toot…" and then Ready. */
type Tap = { tapped: number; making: number; ready: number }

declare global {
  interface Window {
    __starts: Start[]
    __tap: Tap
    /** How many times the page resumed an AudioContext while it handled a click. */
    __resumesInTaps: number
  }
}

const evidence = process.env.E2E_EVIDENCE_DIR ? resolve(process.env.E2E_EVIDENCE_DIR) : null

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

// The service worker would answer a blocked worker script from its cache. The offline test, at
// the end, has it.
test.use({ serviceWorkers: 'block' })

test('plays each Song with your farts, plays a tapped note, and saves it as a Toot', async ({
  page
}, testInfo) => {
  test.setTimeout(600_000)
  const out = evidence && join(evidence, testInfo.project.name)
  if (out) mkdirSync(out, { recursive: true })

  await listenToThePage(page)
  await page.goto('/profile/')
  await loadTheFixtureLibrary(page)
  if (out) await page.screenshot({ path: join(out, 'compose.png') })

  const timings: { song: string; tapToReadyMs: number; makingMs: number }[] = []
  for (const song of songs) {
    await test.step(song.id, async () => {
      const link = page
        .getByTestId('unlocked-songs')
        .locator(`[data-song="${song.id}"]`)
        .getByRole('link')
      await expectTappable(link)

      // From the tap to the made Toot, timed in the page.
      await watchTap(page)
      await page.evaluate(() => (window.__resumesInTaps = 0))
      await link.click()
      await expect(page).toHaveURL(new RegExp(`/compose/${song.id}/$`))
      // The tap itself starts the sound, as iPhone Safari needs, so the Toot can play once made.
      expect(await page.evaluate(() => window.__resumesInTaps)).toBe(1)
      await expect(page.getByRole('heading', { name: song.title, exact: true })).toBeVisible()
      const state = page.getByTestId('song-creator-state')
      await expect(state).toBeVisible({ timeout: 60_000 })
      const tap = await page.evaluate(() => window.__tap)
      expect(tap.making).toBeGreaterThan(0)
      timings.push({
        song: song.id,
        tapToReadyMs: Math.round(tap.ready - tap.tapped),
        makingMs: Math.round(tap.ready - tap.making)
      })

      // It starts playing by itself: the whole Toot, which isn't silence.
      await expect(state).toHaveText('Playing')
      const whole = await lastStart(page)
      expect(whole.args).toEqual([])
      expect(whole.duration).toBeGreaterThan(5)
      expect(whole.peak).toBeGreaterThan(0.05)
      await expect(page.getByTestId('playhead')).toHaveCount(1)
      if (out && song.id === 'mary') await page.screenshot({ path: join(out, 'mary-playing.png') })

      const play = page.getByTestId('song-creator-play')
      const back = page.getByRole('link', { name: 'Back to Compose' })
      const save = page.getByRole('button', { name: 'Save to Toots' })
      const noteView = page.getByTestId('note-view')
      const used = page.getByTestId('recording-used')
      await expect(used).toHaveCount(song.pitches.length)
      for (const control of [back, play, save, noteView]) await expectTappable(control)
      for (const recording of await used.getByRole('button').all()) await expectTappable(recording)

      // Tapping a note plays just that note of the Toot, and says what it is.
      const index = Math.min(2, song.notes.length - 1)
      const note = song.notes[index]
      await tapNote(noteView, page.getByTestId(`note ${index + 1}`))
      await expect(page.getByTestId('note-caption')).toHaveText(
        /^[A-G]♯?\d · Recording \d+ \([A-G]♯?\d\), shifted [+−]?\d+\.\d semitones · \d+\.\d s$/
      )
      await expect(page.getByTestId(`note ${index + 1}`)).toHaveAccessibleName(/, selected/)
      await expect(page.getByTestId('playhead')).toHaveCount(0)
      const tapped = await lastStart(page)
      expect(tapped.duration).toBe(whole.duration)
      expect(tapped.args[1]).toBeCloseTo((note.start * 60) / song.bpm, 3)
      expect(tapped.args[2]).toBeCloseTo((note.dur * 60) / song.bpm, 3)
      if (out) await page.screenshot({ path: join(out, `${song.id}.png`) })

      // Tapping a Recording plays it alone and highlights the notes it plays.
      await used.first().getByRole('button').click()
      const alone = await lastStart(page)
      expect(alone.duration).toBeLessThan(whole.duration)
      const lowest = song.notes.filter(n => n.pitch === song.pitches[0]).length
      await expect(noteView.getByRole('button', { name: /, highlighted/ })).toHaveCount(lowest)

      // Save turns into a disabled "Saved to Toots". Two taps, before it can turn, still make one
      // Toot (checked below).
      if (song === songs[0]) {
        await save.evaluate(button => {
          ;(button as HTMLButtonElement).click()
          ;(button as HTMLButtonElement).click()
        })
      } else {
        await save.click()
      }
      await expect(page.getByRole('button', { name: 'Saved to Toots' })).toBeDisabled()
      // Without the guard the second tap's write fails on the same id and shows the save error.
      await expect(page.getByText("Couldn't save this Toot.")).toHaveCount(0)
      if (out && song.id === 'mary') await page.screenshot({ path: join(out, 'mary-saved.png') })
      if (out && song.id === 'merryxmas') {
        // Scrolled to the end, the last Recording sits above Save and the tabs.
        await page.mouse.wheel(0, 5000)
        await expect(used.last()).toBeInViewport({ ratio: 1 })
        await page.screenshot({ path: join(out, 'merryxmas-bottom.png') })
      }

      await back.click()
      await expect(page).toHaveURL(/\/compose\/$/)
    })
  }
  // Back went back each time, so the page before Compose is one system Back away.
  await page.goBack()
  await expect(page).toHaveURL(/\/profile\/$/)

  // The Toots in IndexedDB: one per Song, each with its audio as a 44.1 kHz mono 16-bit WAV.
  const toots = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('pedos')
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    const all = await new Promise<{ id: string; songId: string; title: string; seconds: number }[]>(
      (resolve, reject) => {
        const r = db.transaction('toots').objectStore('toots').getAll()
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => reject(r.error)
      }
    )
    db.close()
    return all
  })
  expect(toots.map(t => t.songId).sort()).toEqual(songs.map(s => s.id).sort())
  for (const toot of toots) {
    const song = songs.find(s => s.id === toot.songId)
    expect(toot.title).toBe(song?.title)
    const wav = await tootWav(page, toot.id)
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE')
    expect(wav.readUInt16LE(22)).toBe(1)
    expect(wav.readUInt32LE(24)).toBe(44100)
    expect(wav.readUInt16LE(34)).toBe(16)
    expect(wav.readUInt32LE(40) / 2 / 44100).toBeCloseTo(toot.seconds, 6)
    if (out) writeFileSync(join(out, `${toot.songId}.wav`), wav)
  }

  console.log(`[${testInfo.project.name}] time to Toot (ms):`, JSON.stringify(timings))
  if (out) writeFileSync(join(out, 'timings.json'), `${JSON.stringify(timings, null, 2)}\n`)

  await test.step('a direct load waits on Ready until a tap', async () => {
    // A new tab that was never tapped, as a phone opens a link. Chromium gives every page that
    // Playwright loads the activation of a tap, so this tab says it has none.
    const fresh = await page.context().newPage()
    await listenToThePage(fresh)
    await fresh.addInitScript(() =>
      Object.defineProperty(UserActivation.prototype, 'hasBeenActive', { get: () => false })
    )
    await fresh.goto('/profile/')
    await fresh.goto('/compose/mary/')
    const state = fresh.getByTestId('song-creator-state')
    await expect(state).toHaveText('Ready', { timeout: 60_000 })
    // Long enough for a play to have started: the Toot was made in under a second above.
    await fresh.waitForTimeout(1500)
    await expect(state).toHaveText('Ready')
    expect(await fresh.evaluate(() => window.__starts.length)).toBe(0)
    await fresh.getByTestId('song-creator-play').click()
    await expect(state).toHaveText('Playing')
    // Back, with no Compose before it here, opens Compose in its place.
    await fresh.getByRole('link', { name: 'Back to Compose' }).click()
    await expect(fresh).toHaveURL(/\/compose\/$/)
    await fresh.goBack()
    await expect(fresh).toHaveURL(/\/profile\/$/)
    await fresh.close()
  })

  await test.step("a failed render says it couldn't, and Try again makes it", async () => {
    // Both workers' scripts fail to load; the Recordings are already analyzed.
    const workers = '**/_next/static/chunks/turbopack-worker-*'
    await page.route(workers, route => route.abort())
    await page.goto('/compose/mary/')
    await expect(page.getByText("Couldn't make this Toot.")).toBeVisible({ timeout: 60_000 })
    const tryAgain = page.getByRole('button', { name: 'Try again' })
    await expectTappable(tryAgain)
    await page.unroute(workers)
    await tryAgain.click()
    await expect(page.getByTestId('song-creator-state')).toHaveText('Ready', { timeout: 60_000 })
  })
})

test('a locked Song says how to unlock it, and an unknown Song is not found', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pedos.welcomed', '1'))
  await page.goto('/compose/mary/')
  await expect(page.getByRole('heading', { name: 'Mary Had a Little Lamb' })).toBeVisible()
  await expect(
    page.getByText('This Song is locked. Record the notes it needs to unlock it.')
  ).toBeVisible()
  await expect(page.getByTestId('song-creator-state')).toHaveCount(0)

  const response = await page.goto('/compose/not-a-song/')
  expect(response?.status()).toBe(404)
  await expect(page.getByText('Page not found')).toBeVisible()
})

test.describe('installed', () => {
  test.use({ serviceWorkers: 'allow' })

  test('the installed app opens a Ready Song offline, and makes its Toot', async ({
    page,
    context
  }) => {
    test.setTimeout(240_000)
    await listenToThePage(page)
    await page.goto('/profile/')
    await page.waitForFunction(async () => {
      await navigator.serviceWorker.ready
      return navigator.serviceWorker.controller !== null
    })
    await loadTheFixtureLibrary(page)

    await context.setOffline(true)
    await page.getByTestId('unlocked-songs').locator('[data-song="mary"]').getByRole('link').click()
    await expect(page).toHaveURL(/\/compose\/mary\/$/)
    await expect(page.getByRole('heading', { name: 'Mary Had a Little Lamb' })).toBeVisible()
    await expect(page.getByTestId('song-creator-state')).toBeVisible({ timeout: 60_000 })
    await page.getByTestId('song-creator-play').click()
    await expect(page.getByTestId('song-creator-state')).toHaveText('Playing')
    await context.setOffline(false)
  })
})

/**
 * Records, in the page, each sound it starts (`__starts`) and each AudioContext resume inside a
 * click (`__resumesInTaps`), and skips the Welcome.
 */
async function listenToThePage(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('pedos.welcomed', '1')
    // What the page hears: each sound it starts, with its length and loudest sample.
    window.__starts = []
    const start = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...args) {
      let peak = 0
      for (const sample of this.buffer?.getChannelData(0) ?? [])
        peak = Math.max(peak, Math.abs(sample))
      window.__starts.push({ duration: this.buffer?.duration ?? 0, peak, args: args as number[] })
      return start.apply(this, args)
    }
    // A click reaches the window first while capturing and last while bubbling, so the page's
    // own handlers run in between.
    window.__resumesInTaps = 0
    let inTap = false
    addEventListener('click', () => (inTap = true), { capture: true })
    addEventListener('click', () => (inTap = false))
    const resume = AudioContext.prototype.resume
    AudioContext.prototype.resume = function (this: AudioContext) {
      if (inTap) window.__resumesInTaps += 1
      return resume.call(this)
    }
  })
}

/** Loads the Fixture Library from Profile, then opens Compose with all 12 Songs unlocked. */
async function loadTheFixtureLibrary(page: Page) {
  const library = page.getByTestId('fixture-library')
  await library.getByRole('button', { name: 'Load the Fixture Library' }).click()
  await expect(library.getByRole('button', { name: 'Fixture Library loaded' })).toBeDisabled({
    timeout: 90_000
  })
  await page
    .getByRole('navigation', { name: 'Tabs' })
    .getByRole('link', { name: 'Compose', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: 'Unlocked · 12' })).toBeVisible({
    timeout: 60_000
  })
}

/**
 * Notes, in the page, when the next tap happens, when "Making your Toot…" shows and when Song
 * Creator is Ready, in `window.__tap`. The page stays loaded: Compose opens Song Creator in place.
 */
async function watchTap(page: Page) {
  await page.evaluate(() => {
    const tap: Tap = { tapped: 0, making: 0, ready: 0 }
    window.__tap = tap
    document.addEventListener('click', () => (tap.tapped = performance.now()), {
      capture: true,
      once: true
    })
    const observer = new MutationObserver(() => {
      if (!tap.tapped) return
      if (!tap.making && document.body.textContent?.includes('Making your Toot…')) {
        tap.making = performance.now()
      }
      if (document.querySelector('[data-testid="song-creator-state"]')) {
        tap.ready = performance.now()
        observer.disconnect()
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
  })
}

/** The page's latest sound, once it has started one since the last call. */
async function lastStart(page: Page): Promise<Start> {
  await expect.poll(() => page.evaluate(() => window.__starts.length)).toBeGreaterThan(0)
  return page.evaluate(() => {
    const start = window.__starts[window.__starts.length - 1]
    window.__starts = []
    return start
  })
}

/** Taps the note view where `note` is drawn. The view picks the nearest note. */
async function tapNote(noteView: Locator, note: Locator) {
  const view = await noteView.boundingBox()
  const box = await note.boundingBox()
  if (!view || !box) throw new Error('The note view is not on screen')
  await noteView.click({
    position: { x: box.x - view.x + box.width / 2, y: box.y - view.y + box.height / 2 }
  })
}

/** A Toot's audio, read from IndexedDB. */
async function tootWav(page: Page, id: string): Promise<Buffer> {
  const dataUrl = await page.evaluate(async id => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('pedos')
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    const wav = await new Promise<ArrayBuffer>((resolve, reject) => {
      const r = db.transaction('tootAudio').objectStore('tootAudio').get(id)
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    db.close()
    return new Promise<string>(resolve => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.readAsDataURL(new Blob([wav]))
    })
  }, id)
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
}

/** A control a thumb can hit: at least 44 by 44 CSS pixels, as the iPhone's controls. */
async function expectTappable(control: Locator) {
  const box = await control.boundingBox()
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
}
