import type { Page } from '@playwright/test'
import {
  fartAndSave,
  interrupt,
  lastClickToFirstBatch,
  microphone,
  tapRecord,
  waitForOpenMicrophone,
  withFartingMicrophone
} from './record'
import { onPhone } from './screens'
import { expect, test } from './test'

test.skip(({ viewport }) => !onPhone({ viewport }), 'Phone only')
withFartingMicrophone()

async function openThenInterrupt(page: Page, ...events: ('mute' | 'unmute')[]) {
  await page.goto('/')
  await waitForOpenMicrophone(page)
  for (const [flushes, event] of events.entries()) {
    await interrupt(page, event)
    await expect.poll(async () => (await microphone(page)).flushed).toBe(flushes + 1)
  }
}

function expectOpenedAfresh(mic: Awaited<ReturnType<typeof microphone>>) {
  expect(mic.calls).toBe(2)
  expect(mic.opened).toBe(2)
  expect(mic.live).toBe(1)
  expect(mic.closed).toBe(1)
}

test('after an interruption mutes the microphone, the next tap opens it afresh', async ({
  page
}) => {
  await openThenInterrupt(page, 'mute')
  const mic = await tapRecord(page, { saysStarting: true })
  expectOpenedAfresh(mic)
  console.log(
    `getUserMedia → capture processor (ms): ${mic.processorMs.map(t => t.toFixed(1)).join(', ')}`
  )
})

test('once an interruption is over, the next tap captures on the same microphone', async ({
  page
}) => {
  await openThenInterrupt(page, 'mute', 'unmute')
  const mic = await fartAndSave(page)
  await expect(page.getByTestId('result-note')).toHaveText('G3')
  expect(mic.calls).toBe(1)
  expect(mic.closed).toBe(0)
  expect(lastClickToFirstBatch(mic)).toBeLessThan(100)
})

test('a kept stream that comes back silent is opened afresh by the next tap', async ({ page }) => {
  await openThenInterrupt(page, 'mute', 'unmute')
  expectOpenedAfresh(await tapRecord(page))
  await page.getByTestId('stop-button').click()
  await expect(page.getByTestId('record-status')).toHaveText("Didn't catch that. Try again.")
  expect((await tapRecord(page)).calls).toBe(2)
})

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
    expectOpenedAfresh(await microphone(page))
  })
}
