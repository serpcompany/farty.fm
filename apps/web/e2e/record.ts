import type { Page } from '@playwright/test'
import { expect, test } from './test'

export const g3Fart = '090__carlosramon__17-pet__186119.wav'

const pressSeconds = 0.15
const takeBeyondFartSeconds = 1.3

export function skipWelcome({ offersAccount = false, offersInstall = true } = {}): void {
  const documentWithoutStorage = window.origin === 'null'
  if (documentWithoutStorage) return
  localStorage.setItem('pedos.welcomed', '1')
  if (!offersAccount) localStorage.setItem('pedos.accountStep', 'done')
  if (!offersInstall) localStorage.setItem('pedos.installOffered', '1')
}

export function withFartingMicrophone({ farts = true, granted = true, welcomed = true } = {}) {
  test.use({ fakeMicrophone: { farts } })
  if (granted) test.use({ permissions: ['microphone'] })
  if (welcomed) {
    test.beforeEach(async ({ context }) => {
      await context.addInitScript(skipWelcome)
    })
  }
}

export const microphone = (page: Page) =>
  page.evaluate(() => {
    const mic = window.fartyMic
    return {
      calls: mic.calls,
      calledAt: mic.calledAt,
      opened: mic.tracks.length,
      live: mic.tracks.filter(track => track.readyState === 'live').length,
      clicks: mic.clicks,
      batches: mic.batches,
      fartEnergy: mic.fartEnergy,
      nodes: mic.nodes,
      closed: mic.closed,
      flushed: mic.flushed,
      processorLoads: mic.processorLoads,
      processorMs: mic.processorMs,
      sessions: mic.sessions
    }
  })

export async function waitForOpenMicrophone(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const mic = await microphone(page)
      return mic.nodes - mic.closed
    })
    .toBe(1)
}

export async function startRecordingAFart(page: Page, id = '090'): Promise<void> {
  await page.evaluate(fart => {
    window.fartyMic.fartOnPress = fart
    window.fartyMic.take = { id: -1, seconds: 0 }
  }, id)
  const box = await page.getByTestId('record-button').boundingBox()
  if (!box) throw new Error('No Record button')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await expect
    .poll(() => page.evaluate(() => window.fartyMic.fartPlayedSeconds()), { intervals: [10] })
    .toBeGreaterThanOrEqual(pressSeconds)
  await page.mouse.up()
  await expect(page.getByTestId('stop-button')).toBeVisible()
}

export async function stopPastTheFart(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const mic = window.fartyMic
          return mic.take.seconds - mic.fartSeconds
        }),
      { intervals: [50], timeout: 15_000 }
    )
    .toBeGreaterThanOrEqual(takeBeyondFartSeconds)
  await page.getByTestId('stop-button').click()
  await expect(page.getByRole('heading', { name: 'New Recording' })).toBeVisible()
}

export async function fartAndRecord(page: Page, id = '090'): Promise<void> {
  await startRecordingAFart(page, id)
  await stopPastTheFart(page)
}

export async function fartAndSave(page: Page, id = '090') {
  await waitForOpenMicrophone(page)
  await fartAndRecord(page, id)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('result-note')).toBeVisible()
  return microphone(page)
}

export async function recordAndSave(
  page: Page,
  fart = '090',
  { offersAccount = false } = {}
): Promise<void> {
  await page.addInitScript(skipWelcome, { offersAccount })
  await page.goto('/')
  await waitForOpenMicrophone(page)
  await fartAndRecord(page, fart)
  await page.getByRole('button', { name: 'Save' }).click()
}

export async function recordG3(page: Page, options?: { offersAccount?: boolean }): Promise<void> {
  await recordAndSave(page, '090', options)
  await expect(page.getByTestId('result-note')).toHaveText('G3')
}

export async function recordG3ToRecordings(page: Page): Promise<void> {
  await recordG3(page)
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByTestId('recording-row')).toHaveCount(1)
}

export async function deleteRecording(page: Page, number: number): Promise<void> {
  await page.getByRole('button', { name: `Delete Recording ${number}`, exact: true }).click()
  await page
    .getByRole('alertdialog', { name: `Delete Recording ${number}?` })
    .getByRole('button', { name: 'Delete Recording' })
    .click()
}

export async function tapRecord(page: Page, { saysStarting = false } = {}) {
  await page.getByTestId('record-button').click()
  if (saysStarting) await expect(page.getByRole('button', { name: 'Starting…' })).toBeVisible()
  await expect(page.getByTestId('stop-button')).toBeVisible()
  return microphone(page)
}

export async function tapOnSilence(page: Page): Promise<void> {
  await tapRecord(page)
  await page.getByTestId('stop-button').click()
  await expect(page.getByTestId('record-status')).toHaveText("Didn't catch that. Try again.")
}

export function clickToFirstBatch(clicks: number[], batches: number[]): number[] {
  return clicks.map(at => (batches.find(b => b >= at) ?? Number.POSITIVE_INFINITY) - at)
}

export function lastClickToFirstBatch({
  clicks,
  batches
}: {
  clicks: number[]
  batches: number[]
}) {
  return clickToFirstBatch(clicks, batches).at(-1) ?? Number.POSITIVE_INFINITY
}

export function interrupt(page: Page, type: 'mute' | 'unmute' | 'ended'): Promise<void> {
  return page.evaluate(event => {
    for (const track of window.fartyMic.tracks) track.dispatchEvent(new Event(event))
  }, type)
}
