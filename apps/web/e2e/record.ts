import { resolve } from 'node:path'
import { expect, type Page, test } from '@playwright/test'

/** A Fixture Library Recording, played once into Chromium's fake microphone. */
export function withFakeMicrophone(fixture: string): void {
  const file = resolve(__dirname, '../../../fixtures/recordings', fixture)
  test.use({
    permissions: ['microphone'],
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        // %noloop plays the file once, then silence, like a single take.
        `--use-file-for-fake-audio-capture=${file}%noloop`
      ]
    }
  })
}

/** Skips Welcome, records for `seconds`, stops, and saves the take. */
export async function recordAndSave(page: Page, seconds: number): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('pedos.welcomed', '1'))
  await page.goto('/')
  await page.getByTestId('record-button').click()
  await expect(page.getByTestId('recording-timer')).toBeVisible()
  await page.waitForTimeout(seconds * 1000)
  await page.getByTestId('stop-button').click()
  await expect(page.getByRole('heading', { name: 'New Recording' })).toBeVisible()
  await page.getByRole('button', { name: 'Save' }).click()
}
