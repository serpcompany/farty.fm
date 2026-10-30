import { expect, test } from '@playwright/test'
import {
  fakeMicrophone,
  fartAndRecord,
  fixtureWavs,
  getUserMediaMs,
  savedTake,
  waitForOpenMicrophone
} from './fake-microphone'
import { skipWelcome } from './record'
import { onPhone } from './screens'

// The browser's voice processing is off, so a take is the microphone's raw level, which can be
// quiet (#279). Record still hears a quiet fart, and the take is saved at full level, so Review and
// the Recordings tab play it as loud as any.

test.use({ permissions: ['microphone'] })
test.skip(({ viewport }) => !onPhone({ viewport }), 'Phone only')

test('a fart 50 dB below full level is heard, saved at full level and analyzed as it is', async ({
  page
}) => {
  await page.addInitScript(fakeMicrophone, { wavs: fixtureWavs(), delayMs: getUserMediaMs })
  await page.addInitScript(skipWelcome)
  await page.goto('/')
  await waitForOpenMicrophone(page)

  // 090 peaks at -1.2 dBFS, so the microphone hears it peak at about -50 dBFS.
  await fartAndRecord(page, '090', { gainDb: -49 })
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('result-note')).toHaveText('G3')

  const take = await savedTake(page)
  const peak = take.samples.reduce((max, v) => Math.max(max, Math.abs(v)), 0)
  console.log(`saved take peaks at ${(20 * Math.log10(peak)).toFixed(2)} dBFS`)
  expect(20 * Math.log10(peak)).toBeCloseTo(-1, 0)
})
