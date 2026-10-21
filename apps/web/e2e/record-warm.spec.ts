import { expect, type Page, test } from '@playwright/test'
import {
  type FakeMicrophone,
  fakeMicrophone,
  fartAndRecord,
  fixtureWavs,
  getUserMediaMs,
  microphone,
  waitForOpenMicrophone
} from './fake-microphone'
import { skipWelcome } from './record'

// The microphone stays open on the Record screen, so a tap captures at once and a take keeps the
// 300 ms before it (#148, #149). The fake microphone is in `fake-microphone.ts`.

/** The time from each Record click to the first capture batch after it, in ms. */
function clickToFirstBatch(clicks: number[], batches: number[]): number[] {
  return clicks.map(at => (batches.find(b => b >= at) ?? Number.POSITIVE_INFINITY) - at)
}

/** Fires `type` on every track the microphone gave out, as an interruption on iPhone does. */
function interrupt(page: Page, type: 'mute' | 'ended'): Promise<void> {
  return page.evaluate(event => {
    const mic = (window as unknown as { pedosMic: FakeMicrophone }).pedosMic
    for (const track of mic.tracks) track.dispatchEvent(new Event(event))
  }, type)
}

/** The newest saved Recording's audio, as samples, from the app's IndexedDB. */
function savedTake(page: Page): Promise<{ samples: number[]; sampleRate: number }> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((done, fail) => {
      const request = indexedDB.open('pedos')
      request.onsuccess = () => done(request.result)
      request.onerror = () => fail(request.error)
    })
    const all = await new Promise<ArrayBuffer[]>((done, fail) => {
      const request = database.transaction('audio').objectStore('audio').getAll()
      request.onsuccess = () => done(request.result)
      request.onerror = () => fail(request.error)
    })
    database.close()
    const wav = new DataView(all[all.length - 1])
    const sampleRate = wav.getUint32(24, true)
    let at = 12
    while (String.fromCharCode(...new Uint8Array(wav.buffer, at, 4)) !== 'data') {
      at += 8 + wav.getUint32(at + 4, true)
    }
    const length = wav.getUint32(at + 4, true) / 2
    const samples = Array.from({ length }, (_, i) => wav.getInt16(at + 8 + 2 * i, true) / 0x8000)
    return { samples, sampleRate }
  })
}

test.describe('with microphone permission granted', () => {
  test.use({ permissions: ['microphone'] })
  // Audio timing doesn't depend on the screen size; phone size is how people record.
  test.skip(({ isMobile }) => !isMobile, 'Phone only')

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(fakeMicrophone, { wavs: fixtureWavs(), delayMs: getUserMediaMs })
    await page.addInitScript(skipWelcome)
  })

  test('a tap captures at once, keeps the fart from before it, and the mic opens once per visit', async ({
    page
  }) => {
    await page.goto('/')
    // The Record screen opens the microphone by itself.
    await waitForOpenMicrophone(page)

    // Take 1: only silence. Nothing heard, and the microphone stays open.
    await page.getByTestId('record-button').click()
    await expect(page.getByTestId('stop-button')).toBeVisible()
    await page.getByTestId('stop-button').click()
    await expect(page.getByTestId('record-status')).toHaveText("Didn't catch that. Try again.")
    expect((await microphone(page)).live).toBe(1)

    // Take 2: a fart that starts as the person presses Record. Review lets the microphone go,
    // ends its capture processor and puts the session back to playback.
    await fartAndRecord(page)
    const onReview = await microphone(page)
    expect(onReview.live).toBe(0)
    expect(onReview.closed).toBe(onReview.nodes)
    expect(onReview.sessions.at(-1)).toBe('playback')
    await page.getByRole('button', { name: 'Discard' }).click()

    // Back on Record: the microphone opens again, once.
    await waitForOpenMicrophone(page)
    await fartAndRecord(page)
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('result-note')).toHaveText('G3')

    const mic = await microphone(page)
    expect(mic.calls).toBe(2)
    expect(mic.live).toBe(0)
    // One capture processor per visit, each closed when the microphone was let go.
    expect(mic.nodes).toBe(2)
    expect(mic.closed).toBe(2)
    expect(mic.sessions.filter(type => type === 'play-and-record')).toHaveLength(2)
    expect(mic.sessions.at(-1)).toBe('playback')
    const timings = clickToFirstBatch(mic.clicks, mic.batches)
    console.log(`click → first capture batch (ms): ${timings.map(t => t.toFixed(1)).join(', ')}`)
    expect(timings).toHaveLength(3)
    for (const ms of timings) expect(ms).toBeLessThan(100)

    // The saved take holds the whole fart, from before the click that started it.
    const take = await savedTake(page)
    const energy = take.samples.reduce((sum, v) => sum + v * v, 0)
    const onset = take.samples.findIndex(v => Math.abs(v) > 0.01) / take.sampleRate
    console.log(
      `saved take: ${(take.samples.length / take.sampleRate).toFixed(2)} s, fart starts at ${onset.toFixed(3)} s, ${((100 * energy) / mic.fartEnergy).toFixed(1)}% of its energy kept`
    )
    // The take starts about 150 ms before the fart: the 300 ms pre-roll, less the press.
    expect(onset).toBeGreaterThan(0.05)
    expect(energy / mic.fartEnergy).toBeGreaterThan(0.97)
  })

  test('the microphone closes when the page is hidden or the person leaves Record', async ({
    page
  }) => {
    const setVisibility = (state: 'hidden' | 'visible') =>
      page.evaluate(visibility => {
        Object.defineProperty(document, 'visibilityState', {
          value: visibility,
          configurable: true
        })
        document.dispatchEvent(new Event('visibilitychange'))
      }, state)
    await page.goto('/')
    await waitForOpenMicrophone(page)
    await setVisibility('hidden')
    expect((await microphone(page)).live).toBe(0)
    expect((await microphone(page)).sessions.at(-1)).toBe('playback')
    await setVisibility('visible')
    await waitForOpenMicrophone(page)
    expect((await microphone(page)).sessions.at(-1)).toBe('play-and-record')
    // Toots, because the Next.js dev badge covers the Recordings tab in a dev build.
    await page
      .getByRole('navigation', { name: 'Tabs' })
      .getByRole('link', { name: 'Toots' })
      .click()
    await expect(page).toHaveURL(/\/toots\/$/)
    const left = await microphone(page)
    expect(left.live).toBe(0)
    expect(left.calls).toBe(2)
    expect(left.closed).toBe(left.nodes)
    expect(left.sessions.at(-1)).toBe('playback')
  })

  test('leaving Result opens the microphone only where Record shows', async ({ page }) => {
    test.setTimeout(120_000)
    const tabs = page.getByRole('navigation', { name: 'Tabs' })
    /** Taps a Result button; returns what the microphone did from the tap until `settled`. */
    const leaveResult = async (button: string, settled: () => Promise<void>) => {
      const before = await microphone(page)
      await page.getByRole('button', { name: button, exact: true }).click()
      await settled()
      // Longer than it takes the page to open the microphone, had it tried.
      await page.waitForTimeout(500)
      const after = await microphone(page)
      return {
        opened: after.calls - before.calls,
        sessions: after.sessions.slice(before.sessions.length),
        unclosed: after.nodes - after.closed
      }
    }
    const recordAndSave = async (id: string) => {
      await fartAndRecord(page, id)
      await page.getByRole('button', { name: 'Save' }).click()
      await expect(page.getByTestId('result-note')).toBeVisible()
    }

    await page.goto('/')
    await waitForOpenMicrophone(page)

    // Record another: Record shows idle, so the microphone opens there, once.
    await recordAndSave('090')
    const another = await leaveResult('Record another', () =>
      expect(page.getByTestId('record-button')).toBeEnabled()
    )
    expect(another.opened).toBe(1)
    expect(another.sessions.filter(type => type === 'play-and-record')).toHaveLength(1)
    // Only the open microphone's processor runs; every earlier one was closed.
    await waitForOpenMicrophone(page)

    // Done: on to Recordings, without opening the microphone on the way.
    await recordAndSave('084')
    const done = await leaveResult('Done', () => expect(page).toHaveURL(/\/recordings\/$/))
    expect(done.opened).toBe(0)
    expect(done.sessions).not.toContain('play-and-record')
    expect(done.unclosed).toBe(0)
    await tabs.getByRole('link', { name: 'Record', exact: true }).click()
    await waitForOpenMicrophone(page)

    await recordAndSave('086')
    await leaveResult('Record another', () =>
      expect(page.getByTestId('record-button')).toBeEnabled()
    )
    await waitForOpenMicrophone(page)

    // Try it: on to Song Creator, which plays; the session stays on playback.
    await recordAndSave('094')
    await expect(page.getByTestId('result-progress')).toContainText(
      'You unlocked Mary Had a Little Lamb'
    )
    const tryIt = await leaveResult('Try it', () => expect(page).toHaveURL(/\/compose\/mary\/$/))
    expect(tryIt.opened).toBe(0)
    expect(tryIt.sessions).not.toContain('play-and-record')
    expect(tryIt.unclosed).toBe(0)
  })

  test('after an interruption mutes the microphone, the next tap opens it afresh', async ({
    page
  }) => {
    await page.goto('/')
    await waitForOpenMicrophone(page)
    // Siri, an alarm or a call banner on iPhone mutes the track without ending it.
    await interrupt(page, 'mute')
    // The app empties the capture ring: it heard the interruption.
    await expect.poll(async () => (await microphone(page)).flushed).toBe(1)
    await page.getByTestId('record-button').click()
    await expect(page.getByRole('button', { name: 'Starting…' })).toBeVisible()
    await expect(page.getByTestId('stop-button')).toBeVisible()
    const mic = await microphone(page)
    console.log(
      `getUserMedia → capture processor (ms): ${mic.processorMs.map(t => t.toFixed(1)).join(', ')}`
    )
    expect(mic.calls).toBe(2)
    expect(mic.opened).toBe(2)
    expect(mic.live).toBe(1)
    expect(mic.closed).toBe(1)
  })

  // The app loads its capture processor once getUserMedia answers, which takes longest on a slow
  // phone. An interruption then, and a tap before it has loaded, still open the microphone afresh
  // (#172). Here the processor loads only when the test lets it.
  for (const event of ['mute', 'ended'] as const) {
    test(`an interruption while the microphone opens is heard too (${event})`, async ({ page }) => {
      await page.addInitScript(() => {
        const held = window as unknown as { loadCaptureProcessor: () => void }
        const loaded = new Promise<void>(done => {
          held.loadCaptureProcessor = done
        })
        const addModule = AudioWorklet.prototype.addModule
        AudioWorklet.prototype.addModule = async function (
          this: AudioWorklet,
          ...args: Parameters<AudioWorklet['addModule']>
        ) {
          await loaded
          return addModule.apply(this, args)
        }
      })
      await page.goto('/')
      await expect.poll(async () => (await microphone(page)).live).toBe(1)
      expect((await microphone(page)).nodes).toBe(0)
      await interrupt(page, event)
      await page.getByTestId('record-button').click()
      await expect(page.getByRole('button', { name: 'Starting…' })).toBeVisible()
      await page.evaluate(() =>
        (window as unknown as { loadCaptureProcessor: () => void }).loadCaptureProcessor()
      )
      await expect(page.getByTestId('stop-button')).toBeVisible()
      const mic = await microphone(page)
      expect(mic.calls).toBe(2)
      expect(mic.opened).toBe(2)
      expect(mic.live).toBe(1)
      expect(mic.closed).toBe(1)
    })
  }

  test('the button says Starting… until audio comes in', async ({ page }) => {
    await page.goto('/')
    // Tapped before the microphone has opened.
    await page.getByTestId('record-button').click()
    await expect(page.getByRole('button', { name: 'Starting…' })).toBeVisible()
    await expect(page.getByTestId('stop-button')).toBeVisible()
    expect((await microphone(page)).calls).toBe(1)
  })
})

test.describe('before microphone permission is granted', () => {
  test.skip(({ isMobile }) => !isMobile, 'Phone only')

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(fakeMicrophone, { wavs: {}, delayMs: getUserMediaMs })
  })

  test('allowing the microphone on Welcome leaves it open for the first tap', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Allow microphone' }).click()
    await expect(page.getByRole('button', { name: 'Allow microphone' })).toBeHidden()
    await waitForOpenMicrophone(page)
    await page.getByTestId('record-button').click()
    await expect(page.getByTestId('stop-button')).toBeVisible()
    const mic = await microphone(page)
    expect(mic.calls).toBe(1)
    const [ms] = clickToFirstBatch(mic.clicks, mic.batches)
    console.log(`after Welcome, click → first capture batch: ${ms.toFixed(1)} ms`)
    expect(ms).toBeLessThan(100)
  })

  test('the microphone opens on the first tap, not when Pedos opens', async ({ page }) => {
    await page.addInitScript(skipWelcome)
    await page.goto('/')
    await expect(page.getByTestId('record-button')).toBeEnabled()
    await page.waitForTimeout(getUserMediaMs + 200)
    expect((await microphone(page)).calls).toBe(0)
    await page.getByTestId('record-button').click()
    await expect(page.getByRole('button', { name: 'Starting…' })).toBeVisible()
    await expect(page.getByTestId('stop-button')).toBeVisible()
    expect((await microphone(page)).calls).toBe(1)
  })
})
