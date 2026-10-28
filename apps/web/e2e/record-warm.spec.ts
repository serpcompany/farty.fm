import type { Page } from '@playwright/test'
import { all, bytes } from './database'
import {
  clickToFirstBatch,
  fartAndRecord,
  fartAndSave,
  microphone,
  tapOnSilence,
  tapRecord,
  waitForOpenMicrophone,
  withFartingMicrophone
} from './fake-microphone'
import { onPhone, pageSettled, setVisibility, tab } from './screens'
import { expect, test } from './test'

async function savedTake(page: Page): Promise<{ samples: number[]; sampleRate: number }> {
  const recordings = await all<{ id: string; number: number }>(page, 'recordings')
  const newest = recordings.reduce((a, b) => (b.number > a.number ? b : a))
  const wav = await bytes(page, 'audio', newest.id)
  if (!wav) throw new Error('No audio for the newest Recording')
  const sampleRate = wav.readUInt32LE(24)
  let at = 12
  while (wav.toString('ascii', at, at + 4) !== 'data') at += 8 + wav.readUInt32LE(at + 4)
  const length = wav.readUInt32LE(at + 4) / 2
  const samples = Array.from({ length }, (_, i) => wav.readInt16LE(at + 8 + 2 * i) / 0x8000)
  return { samples, sampleRate }
}

async function expectStillOpen(page: Page) {
  await pageSettled(page)
  const mic = await microphone(page)
  expect(mic.calls).toBe(1)
  expect(mic.live).toBe(1)
  expect(mic.nodes - mic.closed).toBe(1)
  expect(mic.sessions).toEqual(['play-and-record'])
}

test.skip(({ viewport }) => !onPhone({ viewport }), 'Phone only')
withFartingMicrophone()

test('a tap captures at once, keeps the fart from before it, and the mic opens once per launch', async ({
  page
}) => {
  await page.goto('/')
  await waitForOpenMicrophone(page)

  await tapOnSilence(page)
  expect((await microphone(page)).live).toBe(1)

  await fartAndRecord(page)
  await page.getByTestId('review-play').click()
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible()
  const onReview = await microphone(page)
  expect(onReview.live).toBe(1)
  expect(onReview.sessions).toEqual(['play-and-record'])
  await page.getByRole('button', { name: 'Discard' }).click()

  const mic = await fartAndSave(page)
  await expect(page.getByTestId('result-note')).toHaveText('G3')
  expect(mic.calls).toBe(1)
  expect(mic.live).toBe(1)
  expect(mic.nodes).toBe(1)
  expect(mic.closed).toBe(0)
  expect(mic.sessions).toEqual(['play-and-record'])
  const timings = clickToFirstBatch(mic.clicks, mic.batches)
  console.log(`click → first capture batch (ms): ${timings.map(t => t.toFixed(1)).join(', ')}`)
  expect(timings).toHaveLength(3)
  for (const ms of timings) expect(ms).toBeLessThan(100)

  const take = await savedTake(page)
  const energy = take.samples.reduce((sum, v) => sum + v * v, 0)
  const onset = take.samples.findIndex(v => Math.abs(v) > 0.01) / take.sampleRate
  console.log(
    `saved take: ${(take.samples.length / take.sampleRate).toFixed(2)} s, fart starts at ${onset.toFixed(3)} s, ${((100 * energy) / mic.fartEnergy).toFixed(1)}% of its energy kept`
  )
  expect(onset).toBeGreaterThan(0.05)
  expect(energy / mic.fartEnergy).toBeGreaterThan(0.97)
})

test('a browser that would listen while the page is hidden closes the microphone, and stays open on the other tabs', async ({
  page
}) => {
  await page.goto('/')
  await waitForOpenMicrophone(page)
  await setVisibility(page, 'hidden')
  await expect.poll(async () => (await microphone(page)).live).toBe(0)
  expect((await microphone(page)).sessions.at(-1)).toBe('playback')
  await setVisibility(page, 'visible')
  await waitForOpenMicrophone(page)
  expect((await microphone(page)).sessions.at(-1)).toBe('play-and-record')
  await tab(page, 'Toots').click()
  await expect(page).toHaveURL(/\/toots\/$/)
  await pageSettled(page)
  const left = await microphone(page)
  expect(left.live).toBe(1)
  expect(left.calls).toBe(2)
  expect(left.nodes - left.closed).toBe(1)
  expect(left.sessions.at(-1)).toBe('play-and-record')
  await setVisibility(page, 'hidden')
  await expect.poll(async () => (await microphone(page)).live).toBe(0)
  await setVisibility(page, 'visible')
  await waitForOpenMicrophone(page)
  const back = await microphone(page)
  expect(back.calls).toBe(3)
  expect(back.live).toBe(1)
  expect(back.sessions.at(-1)).toBe('play-and-record')
})

test('opened on another tab, Farty opens the microphone only once Record shows', async ({
  page
}) => {
  await page.goto('/toots/')
  await expect(page.getByRole('navigation', { name: 'Tabs' })).toBeVisible()
  await pageSettled(page)
  expect((await microphone(page)).calls).toBe(0)
  await tab(page, 'Record').click()
  await waitForOpenMicrophone(page)
  expect((await microphone(page)).calls).toBe(1)
})

test('the microphone stays open from Result to every screen after it', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/')
  await waitForOpenMicrophone(page)

  await fartAndSave(page, '095')
  await page.getByRole('button', { name: 'Record another', exact: true }).click()
  await expect(page.getByTestId('record-button')).toBeEnabled()
  await expectStillOpen(page)

  await fartAndSave(page, '017')
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(page).toHaveURL(/\/recordings\/$/)
  await expectStillOpen(page)
  await tab(page, 'Record').click()

  await fartAndSave(page, '022')
  await page.getByRole('button', { name: 'Record another', exact: true }).click()
  await expect(page.getByTestId('record-button')).toBeEnabled()

  await fartAndSave(page, '002')
  await expect(page.getByTestId('result-progress')).toContainText(
    'You unlocked Mary Had a Little Lamb'
  )
  await page.getByRole('button', { name: 'Try it', exact: true }).click()
  await expect(page).toHaveURL(/\/compose\/mary\/$/)
  await expect(page.getByTestId('song-creator-play')).toHaveAccessibleName('Stop')
  await expectStillOpen(page)
})

test('the button says Starting… until audio comes in', async ({ page }) => {
  await page.goto('/')
  expect((await tapRecord(page, { saysStarting: true })).calls).toBe(1)
})
