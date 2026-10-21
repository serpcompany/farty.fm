import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, type Page, test } from '@playwright/test'

// The microphone stays open on the Record screen, so a tap captures at once and a take keeps the
// 300 ms before it (#148, #149). getUserMedia is slowed to 800 ms here, about what an iPhone
// takes, so a tap that waited for it would show.

/** Fixture 090 is Melodic: its golden Recording Pitch is G3. */
const fixture = '090__carlosramon__17-pet__186119.wav'
const getUserMediaMs = 800
/** How long the person holds the button: they start to fart as they press, and click on release. */
const pressMs = 150

type FakeMicrophone = {
  /** getUserMedia calls, and the tracks they gave out. */
  calls: number
  tracks: MediaStreamTrack[]
  /** When each Record click and each capture batch happened (`performance.now()`). */
  clicks: number[]
  batches: number[]
  /** The next press on Record plays the fart into the microphone. */
  fartOnPress: boolean
  /** The fart's energy (sum of squares) as the microphone plays it. */
  fartEnergy: number
}

const microphone = (page: Page) =>
  page.evaluate(() => {
    const mic = (window as unknown as { pedosMic: FakeMicrophone }).pedosMic
    return {
      calls: mic.calls,
      opened: mic.tracks.length,
      live: mic.tracks.filter(track => track.readyState === 'live').length,
      clicks: mic.clicks,
      batches: mic.batches,
      fartEnergy: mic.fartEnergy
    }
  })

/**
 * Replaces the microphone with one that answers after `delayMs` and plays the fixture when the
 * person presses Record. It also times each Record click and each batch from the capture worklet.
 */
function fakeMicrophone({ wav, delayMs }: { wav: string; delayMs: number }) {
  const mic: FakeMicrophone = {
    calls: 0,
    tracks: [],
    clicks: [],
    batches: [],
    fartOnPress: false,
    fartEnergy: 0
  }
  ;(window as unknown as { pedosMic: FakeMicrophone }).pedosMic = mic
  let context: AudioContext | null = null
  let output: MediaStreamAudioDestinationNode | null = null
  let fart: AudioBuffer | null = null

  navigator.mediaDevices.getUserMedia = async () => {
    mic.calls += 1
    await new Promise(done => setTimeout(done, delayMs))
    context ??= new AudioContext()
    output ??= context.createMediaStreamDestination()
    if (!fart && wav) {
      const bytes = Uint8Array.from(atob(wav), c => c.charCodeAt(0))
      fart = await context.decodeAudioData(bytes.buffer)
      mic.fartEnergy = fart.getChannelData(0).reduce((sum, v) => sum + v * v, 0)
    }
    // A new track per call, as a real microphone gives.
    const tracks = output.stream.getAudioTracks().map(track => track.clone())
    mic.tracks.push(...tracks)
    return new MediaStream(tracks)
  }

  const onRecord = (event: Event) =>
    event.target instanceof Element && event.target.closest('[data-testid="record-button"]')
  document.addEventListener(
    'pointerdown',
    event => {
      if (!onRecord(event) || !context || !output) return
      void context.resume()
      if (mic.fartOnPress && fart) {
        mic.fartOnPress = false
        const source = context.createBufferSource()
        source.buffer = fart
        source.connect(output)
        source.start()
      }
    },
    true
  )
  document.addEventListener(
    'click',
    event => {
      if (onRecord(event)) mic.clicks.push(performance.now())
    },
    true
  )

  const Native = window.AudioWorkletNode
  window.AudioWorkletNode = class extends Native {
    constructor(...args: ConstructorParameters<typeof AudioWorkletNode>) {
      super(...args)
      this.port.addEventListener('message', () => mic.batches.push(performance.now()))
    }
  }
}

/** The time from each Record click to the first capture batch after it, in ms. */
function clickToFirstBatch(clicks: number[], batches: number[]): number[] {
  return clicks.map(at => (batches.find(b => b >= at) ?? Number.POSITIVE_INFINITY) - at)
}

/** Presses Record, playing the fart from the press, and clicks on release. */
async function fartAndRecord(page: Page): Promise<void> {
  await page.evaluate(() => {
    ;(window as unknown as { pedosMic: FakeMicrophone }).pedosMic.fartOnPress = true
  })
  const box = await page.getByTestId('record-button').boundingBox()
  if (!box) throw new Error('No Record button')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(pressMs)
  await page.mouse.up()
  await expect(page.getByTestId('stop-button')).toBeVisible()
  await page.waitForTimeout(1500)
  await page.getByTestId('stop-button').click()
  await expect(page.getByRole('heading', { name: 'New Recording' })).toBeVisible()
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
    const wav = readFileSync(resolve(__dirname, '../../../fixtures/recordings', fixture))
    await page.addInitScript(fakeMicrophone, {
      wav: wav.toString('base64'),
      delayMs: getUserMediaMs
    })
    await page.addInitScript(() => localStorage.setItem('pedos.welcomed', '1'))
  })

  test('a tap captures at once, keeps the fart from before it, and the mic opens once per visit', async ({
    page
  }) => {
    await page.goto('/')
    // The Record screen opens the microphone by itself.
    await expect.poll(async () => (await microphone(page)).opened).toBe(1)

    // Take 1: only silence. Nothing heard, and the microphone stays open.
    await page.getByTestId('record-button').click()
    await expect(page.getByTestId('stop-button')).toBeVisible()
    await page.getByTestId('stop-button').click()
    await expect(page.getByTestId('record-status')).toHaveText("Didn't catch that. Try again.")
    expect((await microphone(page)).live).toBe(1)

    // Take 2: a fart that starts as the person presses Record. Review lets the microphone go.
    await fartAndRecord(page)
    expect((await microphone(page)).live).toBe(0)
    await page.getByRole('button', { name: 'Discard' }).click()

    // Back on Record: the microphone opens again, once.
    await expect.poll(async () => (await microphone(page)).opened).toBe(2)
    await fartAndRecord(page)
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('result-note')).toHaveText('G3')

    const mic = await microphone(page)
    expect(mic.calls).toBe(2)
    expect(mic.live).toBe(0)
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
    await expect.poll(async () => (await microphone(page)).live).toBe(1)
    await setVisibility('hidden')
    expect((await microphone(page)).live).toBe(0)
    await setVisibility('visible')
    await expect.poll(async () => (await microphone(page)).live).toBe(1)
    // Toots, because the Next.js dev badge covers the Recordings tab in a dev build.
    await page
      .getByRole('navigation', { name: 'Tabs' })
      .getByRole('link', { name: 'Toots' })
      .click()
    await expect(page).toHaveURL(/\/toots\/$/)
    expect((await microphone(page)).live).toBe(0)
    expect((await microphone(page)).calls).toBe(2)
  })

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
    await page.addInitScript(fakeMicrophone, { wav: '', delayMs: getUserMediaMs })
    await page.addInitScript(() => localStorage.setItem('pedos.welcomed', '1'))
  })

  test('the microphone opens on the first tap, not when Pedos opens', async ({ page }) => {
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
