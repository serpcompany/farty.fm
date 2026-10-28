import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { songs } from '../src/lib/catalog/songs.generated'
import { newEmail, signInByApi } from './account'
import { all, bytes } from './database'
import { payAtTheDevCheckout } from './pay'
import { skipWelcome } from './record'
import { expectTappable, tab } from './screens'
import { controlledByTheServiceWorker, errorsWhileOffline } from './service-worker'
import {
  loadTheFixtureLibrary,
  needsTheFixtureLibrary,
  song,
  songsTheFixturesUnlock
} from './songs'
import {
  countResumesInTaps,
  forgetResumesInTaps,
  hearSounds,
  lastSound,
  resumesInTaps,
  soundsStarted
} from './sounds'
import { expect, test } from './test'

type Tap = { tapped: number; making: number; ready: number }

const evidence = process.env.E2E_EVIDENCE_DIR ? resolve(process.env.E2E_EVIDENCE_DIR) : null

needsTheFixtureLibrary()
test.use({ serviceWorkers: 'block' })

test.beforeEach(async ({ context }) => {
  await context.addInitScript(skipWelcome)
  await context.addInitScript(hearSounds)
  await context.addInitScript(countResumesInTaps)
})

async function openComposeWithTheFixtureLibrary(page: Page) {
  await loadTheFixtureLibrary(page)
  await tab(page, 'Compose').click()
  await expect(
    page.getByRole('heading', { name: `Unlocked · ${songsTheFixturesUnlock.length}` })
  ).toBeVisible({ timeout: 60_000 })
}

async function watchTap(page: Page) {
  await page.evaluate(() => {
    const tap: Tap = { tapped: 0, making: 0, ready: 0 }
    Object.assign(window, { fartyTap: tap })
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

function tapTimes(page: Page): Promise<Tap> {
  return page.evaluate(() => (window as unknown as { fartyTap: Tap }).fartyTap)
}

async function tapNote(noteView: Locator, note: Locator) {
  const view = await noteView.boundingBox()
  const box = await note.boundingBox()
  if (!view || !box) throw new Error('The note view is not on screen')
  await noteView.click({
    position: { x: box.x - view.x + box.width / 2, y: box.y - view.y + box.height / 2 }
  })
}

async function expectTheWholeToot(page: Page) {
  await expect(page.getByTestId('song-creator-state')).toHaveText('Playing')
  const whole = await lastSound(page)
  expect(whole.args).toEqual([])
  expect(whole.duration).toBeGreaterThan(5)
  expect(whole.peak).toBeGreaterThan(0.05)
  return whole
}

test('plays each Song with your farts, plays a tapped note, and saves it as a Toot', async ({
  page,
  pageErrors
}, testInfo) => {
  test.setTimeout(600_000)
  pageErrors.expect('net::ERR_FAILED')
  const out = evidence && join(evidence, testInfo.project.name)
  if (out) mkdirSync(out, { recursive: true })

  await page.goto('/profile/')
  await signInByApi(page, newEmail(testInfo, 'songs'))
  await page.reload()
  await openComposeWithTheFixtureLibrary(page)
  if (out) await page.screenshot({ path: join(out, 'compose.png') })

  const timings: { song: string; tapToReadyMs: number; makingMs: number }[] = []
  for (const unlocked of songsTheFixturesUnlock) {
    await test.step(unlocked.id, async () => {
      const link = page
        .getByTestId('unlocked-songs')
        .locator(`[data-song="${unlocked.id}"]`)
        .getByRole('link')
      await expectTappable(link)

      await watchTap(page)
      await forgetResumesInTaps(page)
      await link.click()
      await expect(page).toHaveURL(new RegExp(`/compose/${unlocked.id}/$`))
      expect(await resumesInTaps(page)).toBe(1)
      await expect(page.getByRole('heading', { name: unlocked.title, exact: true })).toBeVisible()
      const state = page.getByTestId('song-creator-state')
      await expect(state).toBeVisible({ timeout: 60_000 })
      const tap = await tapTimes(page)
      expect(tap.making).toBeGreaterThan(0)
      timings.push({
        song: unlocked.id,
        tapToReadyMs: Math.round(tap.ready - tap.tapped),
        makingMs: Math.round(tap.ready - tap.making)
      })

      const whole = await expectTheWholeToot(page)
      const playhead = page.getByTestId('playhead')
      await expect(playhead).toHaveCount(1)
      if (unlocked.id === 'mary') {
        if (out) await page.screenshot({ path: join(out, 'mary-playing.png') })
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await expect(playhead).toHaveCSS('display', 'none')
        await page.emulateMedia({ reducedMotion: null })
      }

      const play = page.getByTestId('song-creator-play')
      const back = page.getByRole('link', { name: 'Back to Compose' })
      const save = page.getByRole('button', { name: 'Save to Toots' })
      const noteView = page.getByTestId('note-view')
      const used = page.getByTestId('recording-used')
      await expect(used).toHaveCount(unlocked.pitches.length)
      if (unlocked.id === 'mary') {
        await expect(used.getByRole('button', { name: /^Recording 1,/ })).toContainText('1.7 s')
      }
      for (const control of [back, play, save, noteView]) await expectTappable(control)
      for (const recording of await used.getByRole('button').all()) await expectTappable(recording)

      const index = Math.min(2, unlocked.notes.length - 1)
      const note = unlocked.notes[index]
      await tapNote(noteView, page.getByTestId(`note ${index + 1}`))
      await expect(page.getByTestId('note-caption')).toHaveText(
        /^[A-G]♯?\d · Recording \d+ \([A-G]♯?\d\) · \d+\.\d s$/
      )
      await expect(page.getByTestId(`note ${index + 1}`)).toHaveAccessibleName(/, selected/)
      await expect(playhead).toHaveCount(0)
      const tapped = await lastSound(page)
      expect(tapped.duration).toBe(whole.duration)
      expect(tapped.args[1]).toBeCloseTo((note.start * 60) / unlocked.bpm, 3)
      expect(tapped.args[2]).toBeCloseTo((note.dur * 60) / unlocked.bpm, 3)
      if (out) await page.screenshot({ path: join(out, `${unlocked.id}.png`) })

      await used.first().getByRole('button').click()
      const alone = await lastSound(page)
      expect(alone.duration).toBeLessThan(whole.duration)
      const lowest = unlocked.notes.filter(n => n.pitch === unlocked.pitches[0]).length
      await expect(noteView.getByRole('button', { name: /, highlighted/ })).toHaveCount(lowest)

      await expect(save).toHaveText('Save to Toots · $0.99')
      if (unlocked === songs[0]) {
        await save.evaluate(button => {
          ;(button as HTMLButtonElement).click()
          ;(button as HTMLButtonElement).click()
        })
      } else {
        await save.click()
      }
      await payAtTheDevCheckout(page)
      await expect(page.getByText("Couldn't save this Toot.")).toHaveCount(0)
      if (out && unlocked.id === 'mary') {
        await page.screenshot({ path: join(out, 'mary-saved.png') })
      }
      if (out && unlocked.id === 'merryxmas') {
        await page.mouse.wheel(0, 5000)
        await expect(used.last()).toBeInViewport({ ratio: 1 })
        await page.screenshot({ path: join(out, 'merryxmas-bottom.png') })
      }

      await back.click()
      await expect(page).toHaveURL(/\/compose\/$/)
    })
  }

  const toots = await all<{ id: string; songId: string; title: string; seconds: number }>(
    page,
    'toots'
  )
  expect(toots.map(t => t.songId).sort()).toEqual(songsTheFixturesUnlock.map(s => s.id).sort())
  for (const toot of toots) {
    expect(toot.title).toBe(song(toot.songId).title)
    const wav = await bytes(page, 'tootAudio', toot.id)
    if (!wav) throw new Error(`No audio for the Toot of ${toot.songId}`)
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
    const fresh = await page.context().newPage()
    await fresh.addInitScript(() =>
      Object.defineProperty(UserActivation.prototype, 'hasBeenActive', { get: () => false })
    )
    await fresh.goto('/profile/')
    await fresh.goto('/compose/mary/')
    const state = fresh.getByTestId('song-creator-state')
    await expect(state).toHaveText('Ready', { timeout: 60_000 })
    expect(await soundsStarted(fresh)).toBe(0)
    await fresh.getByTestId('song-creator-play').click()
    await expect(state).toHaveText('Playing')
    await fresh.getByRole('link', { name: 'Back to Compose' }).click()
    await expect(fresh).toHaveURL(/\/compose\/$/)
    await fresh.goBack()
    await expect(fresh).toHaveURL(/\/profile\/$/)
    await fresh.close()
  })

  await test.step("a failed render says it couldn't, and Try again makes it", async () => {
    const workers = '**/_next/static/chunks/turbopack-worker-*'
    await page.route(workers, route => route.abort())
    await page.goto('/compose/mary/')
    await expect(page.getByText("Couldn't make this Toot.")).toBeVisible({ timeout: 60_000 })
    const tryAgain = page.getByRole('button', { name: 'Try again' })
    await expectTappable(tryAgain)
    await page.unroute(workers)
    await tryAgain.click()
    await expectTheWholeToot(page)
  })
})

test('a locked Song says how to unlock it, and an unknown Song is not found, on no tab', async ({
  page,
  pageErrors
}) => {
  pageErrors.expect('the server responded with a status of 404')
  await page.goto('/compose/mary/')
  await expect(page.getByRole('heading', { name: 'Mary Had a Little Lamb' })).toBeVisible()
  await expect(
    page.getByText('This Song is locked. Record the notes it needs to unlock it.')
  ).toBeVisible()
  await expect(page.getByTestId('song-creator-state')).toHaveCount(0)

  const response = await page.goto('/compose/not-a-song/')
  expect(response?.status()).toBe(404)
  await expect(page.getByText('Page not found')).toBeVisible()
  await expect(
    page.getByRole('navigation', { name: 'Tabs' }).locator('[aria-current]')
  ).toHaveCount(0)
})

test.describe('installed', () => {
  test.use({ serviceWorkers: 'allow' })

  test('the installed app opens a Ready Song offline, and makes its Toot', async ({
    page,
    context,
    pageErrors
  }) => {
    test.setTimeout(240_000)
    pageErrors.expect(...errorsWhileOffline)
    await page.goto('/profile/')
    await controlledByTheServiceWorker(page)
    await openComposeWithTheFixtureLibrary(page)

    await context.setOffline(true)
    await page.getByTestId('unlocked-songs').locator('[data-song="mary"]').getByRole('link').click()
    await expect(page).toHaveURL(/\/compose\/mary\/$/)
    await expect(page.getByRole('heading', { name: 'Mary Had a Little Lamb' })).toBeVisible()
    const state = page.getByTestId('song-creator-state')
    const play = page.getByTestId('song-creator-play')
    await expect(state).toBeVisible({ timeout: 60_000 })
    const whole = await expectTheWholeToot(page)
    await play.click()
    await expect(state).toHaveText('Ready')
    await play.click()
    await expect(state).toHaveText('Playing')
    expect((await lastSound(page)).duration).toBe(whole.duration)
    await context.setOffline(false)
  })
})
