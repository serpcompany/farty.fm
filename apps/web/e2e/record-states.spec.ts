import { expect, type Page, test } from '@playwright/test'
import { firstBatchTimeoutMs } from '../src/lib/audio/recorder'
import {
  fakeMicrophone,
  fartAndRecord,
  fixtureWavs,
  getUserMediaMs,
  microphone,
  waitForOpenMicrophone
} from './fake-microphone'
import { skipWelcome } from './record'
import { onPhone } from './screens'

// Record's states (#281, #314): the grey "Getting the mic ready" screen until the take's audio
// reaches the page, the red Recording screen with the take's waveform drawing live once it does,
// and a hint when it hears nothing. The fake microphone is in `fake-microphone.ts`.

type Watch = {
  /** Capture batches held back from the app while `holding`, and delivered in order after. */
  holding: boolean
  held: (() => void)[]
  /** When the app was handed each capture batch (`performance.now()`). */
  delivered: number[]
  /** The newest bar, the bars drawn and the hint every 20 ms while Record records, and when. */
  levels: number[]
  bars: number[]
  hints: string[]
  times: number[]
  /** When the getting-ready screen and the red Recording screen each appeared in the page. */
  gettingReady: number[]
  recording: number[]
}

/**
 * An init script, after the fake microphone: holds the capture node's batches back from the app
 * while `pedosWatch.holding`, and samples the level and the hint.
 */
function watchRecord(): void {
  const watch: Watch = {
    holding: false,
    held: [],
    delivered: [],
    levels: [],
    bars: [],
    hints: [],
    times: [],
    gettingReady: [],
    recording: []
  }
  ;(window as unknown as { pedosWatch: Watch }).pedosWatch = watch
  const native = Object.getOwnPropertyDescriptor(MessagePort.prototype, 'onmessage')
  const Wrapped = window.AudioWorkletNode
  window.AudioWorkletNode = class extends Wrapped {
    constructor(...args: ConstructorParameters<typeof AudioWorkletNode>) {
      super(...args)
      if (args[1] !== 'pedos-capture' || !native?.set) return
      const port = this.port
      let handler: MessagePort['onmessage'] = null
      Object.defineProperty(port, 'onmessage', {
        configurable: true,
        get: () => handler,
        set(next: MessagePort['onmessage']) {
          handler = next
          native.set?.call(
            port,
            next &&
              ((event: MessageEvent) => {
                const deliver = () => {
                  watch.delivered.push(performance.now())
                  next.call(port, event)
                }
                if (watch.holding) watch.held.push(deliver)
                else deliver()
              })
          )
        }
      })
    }
  }
  setInterval(() => {
    if (!document.querySelector('[data-testid="stop-button"][data-state="recording"]')) return
    const waveform = document.querySelector<HTMLElement>('[data-testid="live-waveform"]')
    watch.levels.push(Number(waveform?.dataset.level))
    watch.bars.push(Number(waveform?.dataset.bars))
    watch.hints.push(document.querySelector('[data-testid="recording-hint"]')?.textContent ?? '')
    watch.times.push(performance.now())
  }, 20)
  // Each screen as it enters the page, stamped as React commits it.
  let shown: 'gettingReady' | 'recording' | null = null
  new MutationObserver(() => {
    const now = document.querySelector('[data-testid="record-getting-ready"]')
      ? 'gettingReady'
      : document.querySelector('[data-testid="recording-screen"][data-state="recording"]')
        ? 'recording'
        : null
    if (now && now !== shown) watch[now].push(performance.now())
    shown = now
  }).observe(document, { subtree: true, childList: true, attributes: true })
}

const watched = (page: Page) =>
  page.evaluate(() => {
    const watch = (window as unknown as { pedosWatch: Watch }).pedosWatch
    return { ...watch, held: watch.held.length }
  })

const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1]

test.describe('Record’s states', () => {
  test.use({ permissions: ['microphone'] })
  // How Record shows a take doesn't depend on the screen size; phone size is how people record.
  test.skip(({ viewport }) => !onPhone({ viewport }), 'Phone only')

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(fakeMicrophone, { wavs: fixtureWavs(), delayMs: getUserMediaMs })
    await page.addInitScript(watchRecord)
    await page.addInitScript(skipWelcome)
    await page.goto('/')
    await waitForOpenMicrophone(page)
  })

  test('Getting the mic ready until audio reaches the page, then the red Recording screen', async ({
    page
  }) => {
    await page.evaluate(() => {
      ;(window as unknown as { pedosWatch: Watch }).pedosWatch.holding = true
    })
    const heldSince = Date.now()
    await page.getByTestId('record-button').click()
    await expect(page.getByRole('dialog', { name: 'Getting the mic ready' })).toBeVisible()
    await expect(page.getByTestId('record-getting-ready')).toContainText('Getting the mic ready…')
    // The grey screen covers the tabs as the red one does: out of reach until the flow closes.
    await expect(page.getByRole('navigation', { name: 'Tabs' })).toHaveAttribute('inert', '')

    // The capture node is sending, but none of it has reached the app: still getting ready.
    // The hold-back must stay well under `firstBatchTimeoutMs` (3 s), after which the take gives
    // up with "couldn't start". More than 5 batches is about 430 ms; a runner too slow for that
    // margin fails the check below rather than flaking later.
    await expect.poll(async () => (await watched(page)).held).toBeGreaterThan(5)
    await expect(page.getByTestId('recording-screen')).toHaveCount(0)
    await expect(page.getByTestId('stop-button')).toHaveCount(0)
    await expect(page.getByTestId('recording-timer')).toHaveCount(0)
    await expect(page.getByTestId('live-waveform')).toHaveCount(0)
    expect(Date.now() - heldSince).toBeLessThan(firstBatchTimeoutMs / 2)
    expect((await watched(page)).recording).toEqual([])

    await page.evaluate(() => {
      const watch = (window as unknown as { pedosWatch: Watch }).pedosWatch
      watch.holding = false
      for (const deliver of watch.held.splice(0)) deliver()
    })
    await expect(page.getByRole('dialog', { name: 'Recording' })).toBeVisible()
    await expect(page.getByTestId('record-getting-ready')).toHaveCount(0)
    const stop = page.getByTestId('stop-button')
    await expect(stop).toHaveAttribute('data-state', 'recording')
    await expect(stop).toBeEnabled()
    await expect(page.getByTestId('recording-timer')).toHaveText(/^0:0\d\.\d$/)
    await expect(page.getByTestId('live-waveform')).toBeVisible()
    // The red screen came in once, and only after the app had the take's first batch.
    const { delivered, recording } = await watched(page)
    expect(recording).toHaveLength(1)
    expect(recording[0]).toBeGreaterThanOrEqual(delivered[0])
  })

  test('turns red as the first audio arrives, and never before it: tap to red, measured', async ({
    page
  }) => {
    const takes = 10
    for (let i = 0; i < takes; i++) {
      await page.getByTestId('record-button').click()
      await expect(page.getByTestId('stop-button')).toHaveAttribute('data-state', 'recording')
      await page.getByTestId('stop-button').click()
      // A silent take: Stop refuses it, and Record is back.
      await expect(page.getByTestId('record-status')).toHaveText("Didn't catch that. Try again.")
      await expect(page.getByTestId('record-button')).toBeEnabled()
    }
    // The fake microphone stamps each click on Record as the page gets it.
    const { clicks: taps } = await microphone(page)
    const { delivered, gettingReady, recording } = await watched(page)
    expect(taps).toHaveLength(takes)
    expect(recording).toHaveLength(takes)
    const toGrey = taps.map((tap, i) => gettingReady[i] - tap)
    const toAudio = taps.map(tap => (delivered.find(at => at >= tap) ?? Number.NaN) - tap)
    const toRed = taps.map((tap, i) => recording[i] - tap)
    for (let i = 0; i < takes; i++) {
      // Grey first, then red only once the app has the take's audio.
      expect(gettingReady[i]).toBeGreaterThanOrEqual(taps[i])
      expect(recording[i]).toBeGreaterThanOrEqual(taps[i] + toAudio[i])
    }
    const ms = (values: number[]) => values.map(v => v.toFixed(1)).join(', ')
    console.log(`tap → getting ready (ms): ${ms(toGrey)}`)
    console.log(`tap → first audio batch handed to the app (ms): ${ms(toAudio)}`)
    console.log(`tap → red Recording screen (ms): ${ms(toRed)}; median ${median(toRed).toFixed(1)}`)
    expect(median(toRed)).toBeLessThan(500)
  })

  test('the waveform moves with the fart and falls back after it, with no hint', async ({
    page
  }) => {
    // 022 records for 3 s, past the hint's 2 s.
    await fartAndRecord(page, '022')
    const { levels, bars, hints } = await watched(page)
    const loudest = Math.max(...levels)
    expect(loudest).toBeGreaterThan(0.5)
    // It moves: many different heights while the fart plays…
    expect(new Set(levels).size).toBeGreaterThan(10)
    // …drops to nothing once it's over, before Stop…
    expect(levels.slice(-5)).toEqual([0, 0, 0, 0, 0])
    // …and draws a bar per 50 ms: about 3 s of take, with its 0.3 s of pre-roll.
    expect(bars[bars.length - 1]).toBeGreaterThan(55)
    expect(hints.every(hint => hint === '')).toBe(true)
  })

  test('a take that hears nothing says so after 2 s, goes on, and Stop agrees', async ({
    page
  }) => {
    await page.getByTestId('record-button').click()
    const stop = page.getByTestId('stop-button')
    await expect(stop).toHaveAttribute('data-state', 'recording')
    const hint = page.getByTestId('recording-hint')
    await expect(hint).toHaveText('')
    await expect(hint).toHaveText("Can't hear anything. Move closer.", { timeout: 4000 })
    // Not before about 2 s of recording.
    const { hints, times } = await watched(page)
    const shownAt = times[hints.findIndex(h => h !== '')]
    expect(shownAt - times[0]).toBeGreaterThan(1800)

    // The take goes on.
    await expect(page.getByTestId('recording-timer')).toHaveText(/^0:03\.\d$/, { timeout: 4000 })
    await expect(stop).toHaveAttribute('data-state', 'recording')
    expect(Math.max(...(await watched(page)).levels)).toBe(0)

    await stop.click()
    await expect(page.getByTestId('record-status')).toHaveText("Didn't catch that. Try again.")
  })
})
