import type { Page } from '@playwright/test'
import {
  getUserMediaMs,
  lastClickToFirstBatch,
  microphone,
  tapRecord,
  waitForOpenMicrophone,
  withFartingMicrophone
} from './fake-microphone'
import { skipWelcome } from './record'
import { onPhone } from './screens'
import { expect, test } from './test'

test.skip(({ viewport }) => !onPhone({ viewport }), 'Phone only')
withFartingMicrophone({ farts: false, granted: false, welcomed: false })

async function expectTheFirstTapToCapture(
  page: Page,
  { saysStarting, within, label }: { saysStarting: boolean; within: number; label: string }
) {
  const mic = await tapRecord(page, { saysStarting })
  expect(mic.calls).toBe(1)
  const ms = lastClickToFirstBatch(mic)
  console.log(`${label}, click → first capture batch: ${ms.toFixed(1)} ms`)
  expect(ms).toBeLessThan(within)
}

test('allowing the microphone on Welcome leaves it open for the first tap', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Allow microphone' }).click()
  await expect(page.getByRole('button', { name: 'Allow microphone' })).toBeHidden()
  await waitForOpenMicrophone(page)
  await expectTheFirstTapToCapture(page, {
    saysStarting: false,
    within: 100,
    label: 'after Welcome'
  })
})

test('the microphone opens on the first tap, not when Farty opens', async ({ page }) => {
  await page.addInitScript(skipWelcome)
  await page.goto('/')
  await expect(page.getByTestId('record-button')).toBeEnabled()
  await expect.poll(async () => (await microphone(page)).processorLoads).toBe(1)
  expect((await microphone(page)).calls).toBe(0)
  await expectTheFirstTapToCapture(page, {
    saysStarting: true,
    within: getUserMediaMs + 100,
    label: 'first tap'
  })
})
