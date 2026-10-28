import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { bytes, closeKeptDatabase, entry, layout, write } from './database'
import { g3Fart } from './record'
import { expect, test } from './test'

const beforeToots = { version: 1, stores: { recordings: 'id', audio: null } }

async function openedBeforeToots(page: Page): Promise<void> {
  await page.goto('/robots.txt')
  await page.evaluate(() => localStorage.setItem('pedos.welcomed', '1'))
}

test('upgrades a database from before Toots and keeps its Recordings', async ({ page }) => {
  const wav = readFileSync(resolve(__dirname, '../../../fixtures/recordings', g3Fart))
  await openedBeforeToots(page)
  await write(
    page,
    [
      {
        store: 'recordings',
        value: {
          id: 'before-toots',
          number: 7,
          createdAt: Date.now(),
          seconds: 0.5,
          sampleRate: 44100,
          waveform: [],
          analysis: { state: 'notAnalyzed' }
        }
      },
      { store: 'audio', bytes: wav.toString('base64'), key: 'before-toots' }
    ],
    beforeToots
  )

  await page.goto('/recordings/')
  await expect(page.getByTestId('recording-row')).toHaveCount(1)
  await expect(page.getByTestId('recording-row')).toContainText('Recording 7')

  expect(await layout(page)).toEqual({
    version: 4,
    stores: ['audio', 'downloads', 'meta', 'outbox', 'recordings', 'tootAudio', 'toots']
  })
  expect((await entry<{ number: number }>(page, 'recordings', 'before-toots'))?.number).toBe(7)
  expect((await bytes(page, 'audio', 'before-toots'))?.byteLength).toBe(wav.byteLength)
  expect((await entry<{ op: string }>(page, 'outbox', 'recordings:before-toots'))?.op).toBe('put')
})

test('asks you to close Farty in your other tabs while one holds the old database open', async ({
  page,
  context
}) => {
  const old = await context.newPage()
  await openedBeforeToots(old)
  await write(old, [], { ...beforeToots, keepOpen: true })

  await page.goto('/recordings/')
  const waiting = page.getByText('Close Farty in your other tabs to carry on.')
  await expect(waiting).toBeVisible()
  await expect(page.getByText('No Recordings yet')).toHaveCount(0)

  await closeKeptDatabase(old)
  await expect(waiting).toHaveCount(0)
  await expect(page.getByText('No Recordings yet')).toBeVisible()

  const blocked = await old.evaluate(
    () =>
      new Promise<boolean>((resolve, reject) => {
        let wasBlocked = false
        const request = indexedDB.open('pedos', 5)
        request.onblocked = () => (wasBlocked = true)
        request.onsuccess = () => {
          request.result.close()
          resolve(wasBlocked)
        }
        request.onerror = () => reject(request.error)
      })
  )
  expect(blocked).toBe(false)
})

test('says Farty was updated when a newer Farty saved the library', async ({ page }) => {
  await openedBeforeToots(page)
  await write(page, [], { ...beforeToots, version: 5 })

  await page.goto('/recordings/')
  await expect(page.getByText('Farty was updated')).toBeVisible()
  await expect(page.getByText('Your library was saved by a newer version of Farty.')).toBeVisible()
  expect((await layout(page)).version).toBe(5)
})
