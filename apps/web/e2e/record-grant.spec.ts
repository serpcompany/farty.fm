import type { Page } from '@playwright/test'
import {
  fartAndSave,
  interrupt,
  lastClickToFirstBatch,
  microphone,
  tapOnSilence,
  tapRecord,
  waitForOpenMicrophone,
  withFartingMicrophone
} from './fake-microphone'
import { onPhone, setVisibility, tab } from './screens'
import { expect, test } from './test'

const pastHiddenListeningMs = 1500
const pastUnmuteWaitMs = 2000

test.skip(({ viewport }) => !onPhone({ viewport }), 'Phone only')
withFartingMicrophone({ granted: false })

test.beforeEach(async ({ page }) => {
  await page.clock.install()
  await page.goto('/')
  await tapOnSilence(page)
  await waitForOpenMicrophone(page)
  expect((await microphone(page)).calls).toBe(1)
})

async function hideWhileMuted(page: Page) {
  await setVisibility(page, 'hidden')
  await interrupt(page, 'mute')
}

test('hidden and shown again, the page keeps its microphone: no new getUserMedia', async ({
  page
}) => {
  await hideWhileMuted(page)
  await page.clock.runFor(pastHiddenListeningMs)
  const hidden = await microphone(page)
  expect(hidden.live).toBe(1)
  expect(hidden.nodes - hidden.closed).toBe(1)
  expect(hidden.sessions.at(-1)).toBe('play-and-record')

  await setVisibility(page, 'visible')
  await interrupt(page, 'unmute')
  await page.clock.runFor(pastUnmuteWaitMs)
  const mic = await fartAndSave(page)
  await expect(page.getByTestId('result-note')).toHaveText('G3')
  expect(mic.calls).toBe(1)
  expect(mic.opened).toBe(1)
  expect(mic.live).toBe(1)
  expect(mic.closed).toBe(0)
  expect(mic.flushed).toBeGreaterThanOrEqual(2)
  expect(lastClickToFirstBatch(mic)).toBeLessThan(100)
})

test('a microphone that unmutes while the page is hidden is let go', async ({ page }) => {
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
  await hideWhileMuted(page)
  await page.clock.runFor(pastHiddenListeningMs)
  await interrupt(page, 'unmute')
  await setVisibility(page, 'visible')
  await page.clock.runFor(pastHiddenListeningMs)
  const mic = await microphone(page)
  expect(mic.calls).toBe(1)
  expect(mic.live).toBe(1)
  expect(mic.closed).toBe(0)
  expect(mic.sessions.at(-1)).toBe('play-and-record')
})

test('hidden longer than the grant lasts outside a tap, the microphone waits for the Record tap', async ({
  page
}) => {
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

  const mic = await tapRecord(page, { saysStarting: true })
  expect(mic.calls).toBe(2)
  expect(mic.live).toBe(1)
  expect(mic.calledAt[1]).toBeGreaterThanOrEqual(mic.clicks.at(-1) ?? Number.POSITIVE_INFINITY)
})

test('a microphone lost while hidden opens again as the page shows, inside the window', async ({
  page
}) => {
  await hideWhileMuted(page)
  await interrupt(page, 'ended')
  expect((await microphone(page)).live).toBe(0)
  await page.clock.fastForward('00:30')
  await setVisibility(page, 'visible')
  await waitForOpenMicrophone(page)
  expect((await microphone(page)).calls).toBe(2)
})
