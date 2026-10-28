import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './test'

export const g3Fart = '090__carlosramon__17-pet__186119.wav'

export function skipWelcome({ offersAccount = false, offersInstall = true } = {}): void {
  const documentWithoutStorage = window.origin === 'null'
  if (documentWithoutStorage) return
  localStorage.setItem('pedos.welcomed', '1')
  if (!offersAccount) localStorage.setItem('pedos.accountStep', 'done')
  if (!offersInstall) localStorage.setItem('pedos.installOffered', '1')
}

export function withFakeMicrophone(fixture: string): void {
  const file = resolve(__dirname, '../../../fixtures/recordings', fixture)
  test.use({
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-audio-capture=${file}%noloop`
      ]
    }
  })
}

export async function recordingTimerShows(page: Page, seconds: number): Promise<void> {
  const timer = page.getByTestId('recording-timer')
  await expect
    .poll(
      async () => {
        const [minutes, secondsPast] = ((await timer.textContent()) ?? '0:00').split(':')
        return Number(minutes) * 60 + Number(secondsPast)
      },
      { intervals: [100] }
    )
    .toBeGreaterThanOrEqual(seconds)
}

export async function recordAndSave(
  page: Page,
  seconds: number,
  { offersAccount = false } = {}
): Promise<void> {
  await page.addInitScript(skipWelcome, { offersAccount })
  await page.goto('/')
  await page.getByTestId('record-button').click()
  await recordingTimerShows(page, Math.ceil(seconds))
  await page.getByTestId('stop-button').click()
  await expect(page.getByRole('heading', { name: 'New Recording' })).toBeVisible()
  await page.getByRole('button', { name: 'Save' }).click()
}

export async function recordG3(page: Page, options?: { offersAccount?: boolean }): Promise<void> {
  await recordAndSave(page, 2, options)
  await expect(page.getByTestId('result-note')).toHaveText('G3')
}

export async function recordG3ToRecordings(page: Page): Promise<void> {
  await recordG3(page)
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByTestId('recording-row')).toHaveCount(1)
}
