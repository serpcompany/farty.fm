import type { Page } from '@playwright/test'
import { firstBatchTimeoutMs } from '../src/lib/audio/recorder'
import { captureProcessor } from './fake-microphone'
import { fartAndRecord, microphone, waitForOpenMicrophone, withFartingMicrophone } from './record'
import { onPhone } from './screens'
import { expect, test } from './test'

type Watch = {
  holding: boolean
  held: (() => void)[]
  delivered: number[]
  levels: number[]
  bars: number[]
  hints: string[]
  times: number[]
  gettingReady: number[]
  recording: number[]
}

function watchRecord(processor: string): void {
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
  ;(window as unknown as { fartyWatch: Watch }).fartyWatch = watch
  const native = Object.getOwnPropertyDescriptor(MessagePort.prototype, 'onmessage')
  const Wrapped = window.AudioWorkletNode
  window.AudioWorkletNode = class extends Wrapped {
    constructor(...args: ConstructorParameters<typeof AudioWorkletNode>) {
      super(...args)
      if (args[1] !== processor || !native?.set) return
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
    const watch = (window as unknown as { fartyWatch: Watch }).fartyWatch
    return { ...watch, held: watch.held.length }
  })

const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1]

const heldBatchesWellUnderTheFirstBatchTimeout = 5
const pastTheSilenceHintMs = 4000
const theSilenceHintNeverBeforeMs = 1800

test.skip(({ viewport }) => !onPhone({ viewport }), 'Phone only')
withFartingMicrophone()

test.beforeEach(async ({ page }) => {
  await page.addInitScript(watchRecord, captureProcessor)
  await page.goto('/')
  await waitForOpenMicrophone(page)
})

test('Getting the mic ready until audio reaches the page, then the red Recording screen', async ({
  page
}) => {
  await page.evaluate(() => {
    ;(window as unknown as { fartyWatch: Watch }).fartyWatch.holding = true
  })
  const heldSince = Date.now()
  await page.getByTestId('record-button').click()
  await expect(page.getByRole('dialog', { name: 'Getting the mic ready' })).toBeVisible()
  await expect(page.getByTestId('record-getting-ready')).toContainText('Getting the mic ready…')
  await expect(page.getByRole('navigation', { name: 'Tabs' })).toHaveAttribute('inert', '')

  await expect
    .poll(async () => (await watched(page)).held)
    .toBeGreaterThan(heldBatchesWellUnderTheFirstBatchTimeout)
  await expect(page.getByTestId('recording-screen')).toHaveCount(0)
  await expect(page.getByTestId('stop-button')).toHaveCount(0)
  await expect(page.getByTestId('recording-timer')).toHaveCount(0)
  await expect(page.getByTestId('live-waveform')).toHaveCount(0)
  expect(Date.now() - heldSince).toBeLessThan(firstBatchTimeoutMs / 2)
  expect((await watched(page)).recording).toEqual([])

  await page.evaluate(() => {
    const watch = (window as unknown as { fartyWatch: Watch }).fartyWatch
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
    await expect(page.getByTestId('record-status')).toHaveText("Didn't catch that. Try again.")
    await expect(page.getByTestId('record-button')).toBeEnabled()
  }
  const { clicks: taps } = await microphone(page)
  const { delivered, gettingReady, recording } = await watched(page)
  expect(taps).toHaveLength(takes)
  expect(recording).toHaveLength(takes)
  const toGrey = taps.map((tap, i) => gettingReady[i] - tap)
  const toAudio = taps.map(tap => (delivered.find(at => at >= tap) ?? Number.NaN) - tap)
  const toRed = taps.map((tap, i) => recording[i] - tap)
  for (let i = 0; i < takes; i++) {
    expect(gettingReady[i]).toBeGreaterThanOrEqual(taps[i])
    expect(recording[i]).toBeGreaterThanOrEqual(taps[i] + toAudio[i])
  }
  const ms = (values: number[]) => values.map(v => v.toFixed(1)).join(', ')
  console.log(`tap → getting ready (ms): ${ms(toGrey)}`)
  console.log(`tap → first audio batch handed to the app (ms): ${ms(toAudio)}`)
  console.log(`tap → red Recording screen (ms): ${ms(toRed)}; median ${median(toRed).toFixed(1)}`)
  expect(median(toRed)).toBeLessThan(500)
})

test('the waveform moves with the fart and falls back after it, with no hint', async ({ page }) => {
  await fartAndRecord(page, '022')
  const { levels, bars, hints } = await watched(page)
  const loudest = Math.max(...levels)
  expect(loudest).toBeGreaterThan(0.5)
  expect(new Set(levels).size).toBeGreaterThan(10)
  expect(levels.slice(-5)).toEqual([0, 0, 0, 0, 0])
  expect(bars[bars.length - 1]).toBeGreaterThan(55)
  expect(hints.every(hint => hint === '')).toBe(true)
})

test('a take that hears nothing says so after 2 s, goes on, and Stop agrees', async ({ page }) => {
  await page.getByTestId('record-button').click()
  const stop = page.getByTestId('stop-button')
  await expect(stop).toHaveAttribute('data-state', 'recording')
  const hint = page.getByTestId('recording-hint')
  await expect(hint).toHaveText('')
  await expect(hint).toHaveText("Can't hear anything. Move closer.", {
    timeout: pastTheSilenceHintMs
  })
  const { hints, times } = await watched(page)
  const shownAt = times[hints.findIndex(h => h !== '')]
  expect(shownAt - times[0]).toBeGreaterThan(theSilenceHintNeverBeforeMs)

  await expect(page.getByTestId('recording-timer')).toHaveText(/^0:03\.\d$/, {
    timeout: pastTheSilenceHintMs
  })
  await expect(stop).toHaveAttribute('data-state', 'recording')
  expect(Math.max(...(await watched(page)).levels)).toBe(0)

  await stop.click()
  await expect(page.getByTestId('record-status')).toHaveText("Didn't catch that. Try again.")
})
