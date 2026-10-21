import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { skipWelcome } from './record'

// The microphone stays open on the Record screen, so a tap captures at once and a take keeps the
// 300 ms before it (#148, #149). getUserMedia is slowed to 800 ms here, about what an iPhone
// takes, so a tap that waited for it would show.

/**
 * The farts the microphone can play, by fixture id. 090 is Melodic, with golden Recording Pitch
 * G3. With 084, 086 (both G♯3) and 094 (B3) it unlocks Mary Had a Little Lamb (see compose.spec).
 */
const fixtures: Record<string, string> = {
  '090': '090__carlosramon__17-pet__186119.wav',
  '084': '084__walter-odington__grim-fart__26216.wav',
  '086': '086__walter-odington__little-parp__26793.wav',
  '094': '094__manicciola__fart__121783.wav'
}
/** How long each take records after the press, in ms: about a second longer than its fart. */
const takeMs: Record<string, number> = { '090': 1500, '084': 3500, '086': 1500, '094': 5750 }
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
  /** The fixture id the next press on Record plays into the microphone. */
  fartOnPress: string | null
  /** The last fart's energy (sum of squares) as the microphone played it. */
  fartEnergy: number
  /** Capture worklet nodes made, and how many were told to close. */
  nodes: number
  closed: number
  /** Each audio session type the app set, in order (a stand-in for Safari's `audioSession`). */
  sessions: string[]
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
      fartEnergy: mic.fartEnergy,
      nodes: mic.nodes,
      closed: mic.closed,
      sessions: mic.sessions
    }
  })

/**
 * Replaces the microphone with one that answers after `delayMs` and plays a fixture when the
 * person presses Record. It also times each Record click and each batch from the capture worklet,
 * counts the worklet nodes and their closing, and records the audio session the app sets.
 */
function fakeMicrophone({ wavs, delayMs }: { wavs: Record<string, string>; delayMs: number }) {
  const mic: FakeMicrophone = {
    calls: 0,
    tracks: [],
    clicks: [],
    batches: [],
    fartOnPress: null,
    fartEnergy: 0,
    nodes: 0,
    closed: 0,
    sessions: []
  }
  const page = window as unknown as { pedosMic: FakeMicrophone; pedosMediaDevices: MediaDevices }
  page.pedosMic = mic
  // WebKit's garbage collector drops a `navigator.mediaDevices` wrapper nothing holds, and the
  // replaced getUserMedia with it. Holding it keeps the fake.
  page.pedosMediaDevices = navigator.mediaDevices
  let context: AudioContext | null = null
  let output: MediaStreamAudioDestinationNode | null = null
  const farts: Record<string, AudioBuffer> = {}

  let sessionType = 'auto'
  Object.defineProperty(navigator, 'audioSession', {
    configurable: true,
    value: {
      get type() {
        return sessionType
      },
      set type(type: string) {
        sessionType = type
        mic.sessions.push(type)
      }
    }
  })

  navigator.mediaDevices.getUserMedia = async () => {
    mic.calls += 1
    await new Promise(done => setTimeout(done, delayMs))
    context ??= new AudioContext()
    output ??= context.createMediaStreamDestination()
    for (const [id, wav] of Object.entries(wavs)) {
      if (farts[id]) continue
      const bytes = Uint8Array.from(atob(wav), c => c.charCodeAt(0))
      farts[id] = await context.decodeAudioData(bytes.buffer)
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
      const fart = mic.fartOnPress && farts[mic.fartOnPress]
      if (fart) {
        mic.fartOnPress = null
        mic.fartEnergy = fart.getChannelData(0).reduce((sum, v) => sum + v * v, 0)
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
      mic.nodes += 1
      this.port.addEventListener('message', () => mic.batches.push(performance.now()))
      const post = this.port.postMessage.bind(this.port)
      this.port.postMessage = ((
        message: { type?: string },
        options?: StructuredSerializeOptions
      ) => {
        if (message?.type === 'close') mic.closed += 1
        post(message, options)
      }) as MessagePort['postMessage']
    }
  }
}

/** Every fixture the fake microphone can play, as base64. */
function fixtureWavs(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fixtures).map(([id, file]) => [
      id,
      readFileSync(resolve(__dirname, '../../../fixtures/recordings', file)).toString('base64')
    ])
  )
}

/** The time from each Record click to the first capture batch after it, in ms. */
function clickToFirstBatch(clicks: number[], batches: number[]): number[] {
  return clicks.map(at => (batches.find(b => b >= at) ?? Number.POSITIVE_INFINITY) - at)
}

/** Presses Record, playing fixture `id` from the press, and clicks on release. */
async function fartAndRecord(page: Page, id = '090'): Promise<void> {
  await page.evaluate(fart => {
    ;(window as unknown as { pedosMic: FakeMicrophone }).pedosMic.fartOnPress = fart
  }, id)
  const box = await page.getByTestId('record-button').boundingBox()
  if (!box) throw new Error('No Record button')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(pressMs)
  await page.mouse.up()
  await expect(page.getByTestId('stop-button')).toBeVisible()
  await page.waitForTimeout(takeMs[id])
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
    await page.addInitScript(fakeMicrophone, { wavs: fixtureWavs(), delayMs: getUserMediaMs })
    await page.addInitScript(skipWelcome)
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

    // Take 2: a fart that starts as the person presses Record. Review lets the microphone go,
    // ends its capture processor and puts the session back to playback.
    await fartAndRecord(page)
    const onReview = await microphone(page)
    expect(onReview.live).toBe(0)
    expect(onReview.closed).toBe(onReview.nodes)
    expect(onReview.sessions.at(-1)).toBe('playback')
    await page.getByRole('button', { name: 'Discard' }).click()

    // Back on Record: the microphone opens again, once.
    await expect.poll(async () => (await microphone(page)).opened).toBe(2)
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
    await expect.poll(async () => (await microphone(page)).live).toBe(1)
    await setVisibility('hidden')
    expect((await microphone(page)).live).toBe(0)
    expect((await microphone(page)).sessions.at(-1)).toBe('playback')
    await setVisibility('visible')
    await expect.poll(async () => (await microphone(page)).live).toBe(1)
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
    await expect.poll(async () => (await microphone(page)).live).toBe(1)

    // Record another: Record shows idle, so the microphone opens there, once.
    await recordAndSave('090')
    const another = await leaveResult('Record another', () =>
      expect(page.getByTestId('record-button')).toBeEnabled()
    )
    expect(another.opened).toBe(1)
    expect(another.sessions.filter(type => type === 'play-and-record')).toHaveLength(1)
    await expect.poll(async () => (await microphone(page)).live).toBe(1)
    // Only the open microphone's processor runs; every earlier one was closed.
    const open = await microphone(page)
    expect(open.nodes - open.closed).toBe(1)

    // Done: on to Recordings, without opening the microphone on the way.
    await recordAndSave('084')
    const done = await leaveResult('Done', () => expect(page).toHaveURL(/\/recordings\/$/))
    expect(done.opened).toBe(0)
    expect(done.sessions).not.toContain('play-and-record')
    expect(done.unclosed).toBe(0)
    await tabs.getByRole('link', { name: 'Record', exact: true }).click()
    await expect.poll(async () => (await microphone(page)).live).toBe(1)

    await recordAndSave('086')
    await leaveResult('Record another', () =>
      expect(page.getByTestId('record-button')).toBeEnabled()
    )
    await expect.poll(async () => (await microphone(page)).live).toBe(1)

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
    await expect.poll(async () => (await microphone(page)).live).toBe(1)
    // Siri, an alarm or a call banner on iPhone mutes the track without ending it.
    await page.evaluate(() => {
      const mic = (window as unknown as { pedosMic: FakeMicrophone }).pedosMic
      for (const track of mic.tracks) track.dispatchEvent(new Event('mute'))
    })
    await page.getByTestId('record-button').click()
    await expect(page.getByRole('button', { name: 'Starting…' })).toBeVisible()
    await expect(page.getByTestId('stop-button')).toBeVisible()
    const mic = await microphone(page)
    expect(mic.calls).toBe(2)
    expect(mic.opened).toBe(2)
    expect(mic.live).toBe(1)
    expect(mic.closed).toBe(1)
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
    await page.addInitScript(fakeMicrophone, { wavs: {}, delayMs: getUserMediaMs })
  })

  test('allowing the microphone on Welcome leaves it open for the first tap', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Allow microphone' }).click()
    await expect(page.getByRole('button', { name: 'Allow microphone' })).toBeHidden()
    await expect.poll(async () => (await microphone(page)).live).toBe(1)
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
