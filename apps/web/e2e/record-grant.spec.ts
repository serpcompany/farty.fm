import type { Page } from '@playwright/test'
import { captureProcessor } from './fake-microphone'
import {
  fartAndRecord,
  fartAndSave,
  interrupt,
  lastClickToFirstBatch,
  microphone,
  tapOnSilence,
  tapRecord,
  waitForOpenMicrophone,
  withFartingMicrophone
} from './record'
import { onPhone, setVisibility, tab } from './screens'
import { expect, test } from './test'

const pastHiddenListeningMs = 1500
const pastUnmuteWaitMs = 2000
const aSecondAfterComingBackMs = 1000

test.skip(({ viewport }) => !onPhone({ viewport }), 'Phone only')
withFartingMicrophone({ granted: false })

test.beforeEach(async ({ page }) => {
  await page.clock.install()
})

async function openWithTheFirstTap(page: Page) {
  await page.goto('/')
  await tapOnSilence(page)
  await waitForOpenMicrophone(page)
  expect((await microphone(page)).calls).toBe(1)
}

async function hideWhileMuted(page: Page) {
  await setVisibility(page, 'hidden')
  await interrupt(page, 'mute')
}

async function showUnmuted(page: Page) {
  await setVisibility(page, 'visible')
  await interrupt(page, 'unmute')
}

function stallContextsOnHide(processor: string): void {
  const contexts = new Set<BaseAudioContext>()
  const Counted = window.AudioWorkletNode
  window.AudioWorkletNode = class extends Counted {
    constructor(...args: ConstructorParameters<typeof AudioWorkletNode>) {
      super(...args)
      if (args[1] === processor) contexts.add(args[0])
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return
    for (const context of contexts) {
      if (!(context instanceof AudioContext) || context.state === 'closed') continue
      const close = context.close.bind(context)
      let closed = false
      void context.suspend()
      Object.defineProperty(context, 'state', { get: () => (closed ? 'closed' : 'running') })
      context.resume = async () => {}
      context.close = () => {
        closed = true
        return close()
      }
    }
    contexts.clear()
  })
}

test('hidden and shown again, the page keeps its microphone: no new getUserMedia', async ({
  page
}) => {
  await openWithTheFirstTap(page)
  await hideWhileMuted(page)
  await page.clock.runFor(pastHiddenListeningMs)
  const hidden = await microphone(page)
  expect(hidden.live).toBe(1)
  expect(hidden.nodes - hidden.closed).toBe(1)
  expect(hidden.sessions.at(-1)).toBe('play-and-record')

  await showUnmuted(page)
  await page.clock.runFor(pastUnmuteWaitMs)
  const mic = await fartAndSave(page)
  await expect(page.getByTestId('result-note')).toHaveText('G3')
  expect(mic.calls).toBe(1)
  expect(mic.opened).toBe(1)
  expect(mic.live).toBe(1)
  expect(mic.nodes).toBe(2)
  expect(mic.closed).toBe(1)
  expect(mic.flushed).toBeGreaterThanOrEqual(2)
  expect(lastClickToFirstBatch(mic)).toBeLessThan(100)
})

test('the first tap after coming back records at once, though the old context stood still', async ({
  page
}) => {
  await page.addInitScript(stallContextsOnHide, captureProcessor)
  await openWithTheFirstTap(page)
  await hideWhileMuted(page)
  await page.clock.runFor(pastHiddenListeningMs)
  await showUnmuted(page)
  await page.clock.runFor(aSecondAfterComingBackMs)
  const mic = await fartAndSave(page)
  await expect(page.getByTestId('result-note')).toHaveText('G3')
  expect(mic.calls).toBe(1)
  expect(mic.live).toBe(1)
  const ms = lastClickToFirstBatch(mic)
  console.log(`click → first capture batch after coming back (ms): ${ms.toFixed(1)}`)
  expect(ms).toBeLessThan(100)
})

test('a sound that started while the page was hidden ends as the page shows', async ({ page }) => {
  await openWithTheFirstTap(page)
  await fartAndRecord(page)
  const play = page.getByTestId('review-play')
  await expect(play).toHaveAccessibleName(/^Play/)

  await hideWhileMuted(page)
  await play.click()
  await expect(play).toHaveAccessibleName('Stop')
  await showUnmuted(page)
  await expect(play).toHaveAccessibleName(/^Play/)

  await play.click()
  await expect(play).toHaveAccessibleName('Stop')
})

test('a microphone that unmutes while the page is hidden is let go', async ({ page }) => {
  await openWithTheFirstTap(page)
  await interrupt(page, 'mute')
  await setVisibility(page, 'hidden')
  await page.clock.runFor(pastHiddenListeningMs)
  expect((await microphone(page)).live).toBe(1)

  await interrupt(page, 'unmute')
  await expect.poll(async () => (await microphone(page)).live).toBe(0)
  const mic = await microphone(page)
  expect(mic.nodes - mic.closed).toBe(0)
  expect(mic.sessions.at(-1)).toBe('playback')
})

test('a microphone that unmutes as the page shows is kept', async ({ page }) => {
  await openWithTheFirstTap(page)
  await hideWhileMuted(page)
  await page.clock.runFor(pastHiddenListeningMs)
  await interrupt(page, 'unmute')
  await setVisibility(page, 'visible')
  await page.clock.runFor(pastHiddenListeningMs)
  const mic = await microphone(page)
  expect(mic.calls).toBe(1)
  expect(mic.live).toBe(1)
  expect(mic.nodes).toBe(2)
  expect(mic.closed).toBe(1)
  expect(mic.sessions.at(-1)).toBe('play-and-record')
})

test('hidden longer than the grant lasts outside a tap, the microphone waits for the Record tap', async ({
  page
}) => {
  await openWithTheFirstTap(page)
  await hideWhileMuted(page)
  await page.clock.fastForward('01:00')
  await setVisibility(page, 'visible')
  await expect.poll(async () => (await microphone(page)).live).toBe(0)
  expect((await microphone(page)).calls).toBe(1)

  await tab(page, 'Toots').click()
  await expect(page).toHaveURL(/\/toots\/$/)
  await tab(page, 'Record').click()
  await expect(page.getByTestId('record-button')).toBeEnabled()
  expect((await microphone(page)).calls).toBe(1)

  const mic = await tapRecord(page, { getsTheMicReady: true })
  expect(mic.calls).toBe(2)
  expect(mic.live).toBe(1)
  expect(mic.calledAt[1]).toBeGreaterThanOrEqual(mic.clicks.at(-1) ?? Number.POSITIVE_INFINITY)
})

test('a microphone lost while hidden opens again as the page shows, inside the window', async ({
  page
}) => {
  await openWithTheFirstTap(page)
  await hideWhileMuted(page)
  await interrupt(page, 'ended')
  expect((await microphone(page)).live).toBe(0)
  await page.clock.fastForward('00:30')
  await setVisibility(page, 'visible')
  await waitForOpenMicrophone(page)
  expect((await microphone(page)).calls).toBe(2)
})
