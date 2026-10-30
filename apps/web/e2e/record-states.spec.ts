import { expect, type Page, test } from '@playwright/test'
import {
  fakeMicrophone,
  fartAndRecord,
  fixtureWavs,
  getUserMediaMs,
  waitForOpenMicrophone
} from './fake-microphone'
import { skipWelcome } from './record'
import { onPhone } from './screens'

// Record's states (#281): getting ready until the take's audio reaches the page, recording with a
// live level once it does, a hint when it hears nothing, and a vibration as it starts. The fake
// microphone is in `fake-microphone.ts`.

type Watch = {
  /** Capture batches held back from the app while `holding`, and delivered in order after. */
  holding: boolean
  held: (() => void)[]
  /** Each `navigator.vibrate` call's duration. */
  vibrations: number[]
  /** The level and the hint every 20 ms while Record records, and when (`performance.now()`). */
  levels: number[]
  hints: string[]
  times: number[]
}

/**
 * An init script, after the fake microphone: holds the capture node's batches back from the app
 * while `pedosWatch.holding`, counts vibrations, and samples the level and the hint.
 */
function watchRecord(): void {
  const watch: Watch = {
    holding: false,
    held: [],
    vibrations: [],
    levels: [],
    hints: [],
    times: []
  }
  ;(window as unknown as { pedosWatch: Watch }).pedosWatch = watch
  Object.defineProperty(navigator, 'vibrate', {
    configurable: true,
    value: (pattern: number) => {
      watch.vibrations.push(pattern)
      return true
    }
  })
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
                const deliver = () => next.call(port, event)
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
    const level = document.querySelector<HTMLElement>('[data-testid="input-level"]')
    watch.levels.push(Number(level?.dataset.level))
    watch.hints.push(document.querySelector('[data-testid="recording-hint"]')?.textContent ?? '')
    watch.times.push(performance.now())
  }, 20)
}

const watched = (page: Page) =>
  page.evaluate(() => {
    const watch = (window as unknown as { pedosWatch: Watch }).pedosWatch
    return {
      holding: watch.holding,
      held: watch.held.length,
      vibrations: watch.vibrations,
      levels: watch.levels,
      hints: watch.hints,
      times: watch.times
    }
  })

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

  test('getting ready until audio reaches the page, then recording, with a vibration', async ({
    page
  }) => {
    await page.evaluate(() => {
      ;(window as unknown as { pedosWatch: Watch }).pedosWatch.holding = true
    })
    await page.getByTestId('record-button').click()
    const button = page.getByRole('button', { name: 'Starting…' })
    await expect(button).toBeVisible()
    await expect(button).toBeDisabled()
    await expect(button).toHaveAttribute('data-state', 'starting')

    // The capture node is sending, but none of it has reached the page: still getting ready.
    await expect.poll(async () => (await watched(page)).held).toBeGreaterThan(5)
    await expect(page.getByTestId('stop-button')).toHaveCount(0)
    await expect(page.getByTestId('recording-timer')).toHaveCount(0)
    await expect(page.getByTestId('input-level')).toHaveCount(0)
    expect((await watched(page)).vibrations).toEqual([])

    await page.evaluate(() => {
      const watch = (window as unknown as { pedosWatch: Watch }).pedosWatch
      watch.holding = false
      for (const deliver of watch.held.splice(0)) deliver()
    })
    const stop = page.getByTestId('stop-button')
    await expect(stop).toHaveAttribute('data-state', 'recording')
    await expect(stop).toBeEnabled()
    await expect(page.getByTestId('recording-timer')).toHaveText('0:00')
    await expect(page.getByTestId('input-level')).toBeVisible()
    expect((await watched(page)).vibrations).toEqual([30])
  })

  test('the level moves with the fart and falls back after it, with no hint', async ({ page }) => {
    // 022 records for 3 s, past the hint's 2 s.
    await fartAndRecord(page, '022')
    const { levels, hints } = await watched(page)
    const loudest = Math.max(...levels)
    expect(loudest).toBeGreaterThan(0.5)
    // It moves: many different levels while the fart plays…
    expect(new Set(levels).size).toBeGreaterThan(10)
    // …and drops to nothing once it's over, before Stop.
    expect(levels.slice(-5)).toEqual([0, 0, 0, 0, 0])
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
    await expect(page.getByTestId('recording-timer')).toHaveText('0:03', { timeout: 4000 })
    await expect(stop).toHaveAttribute('data-state', 'recording')
    expect(Math.max(...(await watched(page)).levels)).toBe(0)

    await stop.click()
    await expect(page.getByTestId('record-status')).toHaveText("Didn't catch that. Try again.")
  })
})
