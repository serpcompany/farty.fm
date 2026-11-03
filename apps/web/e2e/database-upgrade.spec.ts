import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { bytes, closeKeptDatabase, entry, keys, layout, write } from './database'
import { g3Fart } from './record'
import { expect, test } from './test'

const beforeToots = { version: 1, stores: { recordings: 'id', audio: null } }
const beforeNames = {
  version: 7,
  stores: {
    recordings: 'id',
    toots: 'id',
    outbox: 'key',
    audio: null,
    tootAudio: null,
    downloads: null,
    meta: null,
    pads: null,
    favorites: null
  }
}
const thisFartysVersion = 8
const aNewerFartysVersion = thisFartysVersion + 1

function aRecording(id: string, number: number) {
  return {
    store: 'recordings',
    value: {
      id,
      number,
      createdAt: Date.now(),
      seconds: 0.5,
      sampleRate: 44100,
      waveform: [],
      analysis: { state: 'notAnalyzed' }
    }
  }
}

async function beforeFartyOpens(page: Page): Promise<void> {
  await page.goto('/robots.txt')
  await page.evaluate(() => localStorage.setItem('pedos.welcomed', '1'))
}

test('upgrades a database from before Toots and keeps its Recordings', async ({ page }) => {
  const wav = readFileSync(resolve(__dirname, '../../../fixtures/recordings', g3Fart))
  await beforeFartyOpens(page)
  await write(
    page,
    [
      aRecording('before-toots', 7),
      { store: 'audio', bytes: wav.toString('base64'), key: 'before-toots' }
    ],
    beforeToots
  )

  await page.goto('/recordings/')
  await expect(page.getByTestId('recording-row')).toHaveCount(1)
  await expect(page.getByTestId('recording-row')).toContainText('Recording 7')

  expect(await layout(page)).toEqual({
    version: thisFartysVersion,
    stores: [
      'audio',
      'downloads',
      'favorites',
      'meta',
      'outbox',
      'pads',
      'recordings',
      'tootAudio',
      'toots'
    ]
  })
  expect((await entry<{ number: number }>(page, 'recordings', 'before-toots'))?.number).toBe(7)
  expect((await bytes(page, 'audio', 'before-toots'))?.byteLength).toBe(wav.byteLength)
  expect((await entry<{ op: string }>(page, 'outbox', 'recordings:before-toots'))?.op).toBe('put')
})

test('upgrades a database from before names and keeps its Recordings and Favorite Songs', async ({
  page
}) => {
  const wav = readFileSync(resolve(__dirname, '../../../fixtures/recordings', g3Fart))
  await beforeFartyOpens(page)
  await write(
    page,
    [
      aRecording('before-names', 4),
      { store: 'audio', bytes: wav.toString('base64'), key: 'before-names' },
      { store: 'favorites', value: Date.now(), key: 'twinkle-twinkle-little-star' }
    ],
    beforeNames
  )

  await page.goto('/recordings/')
  await expect(page.getByTestId('recording-row')).toHaveCount(1)
  await expect(page.getByTestId('recording-row')).toContainText('Recording 4')

  expect((await layout(page)).version).toBe(thisFartysVersion)
  expect(await keys(page, 'recordings')).toEqual(['before-names'])
  expect(await keys(page, 'audio')).toEqual(['before-names'])
  expect(await keys(page, 'favorites')).toEqual(['twinkle-twinkle-little-star'])
})

test('asks you to close Farty in your other tabs while one holds the old database open', async ({
  page,
  context
}) => {
  const old = await context.newPage()
  await beforeFartyOpens(old)
  await write(old, [], { ...beforeToots, keepOpen: true })

  await page.goto('/recordings/')
  const waiting = page.getByText('Close Farty in your other tabs to carry on.')
  await expect(waiting).toBeVisible()
  await expect(page.getByText('No Recordings yet')).toHaveCount(0)

  await closeKeptDatabase(old)
  await expect(waiting).toHaveCount(0)
  await expect(page.getByText('No Recordings yet')).toBeVisible()

  const blocked = await old.evaluate(
    version =>
      new Promise<boolean>((resolve, reject) => {
        let wasBlocked = false
        const request = indexedDB.open('pedos', version)
        request.onblocked = () => (wasBlocked = true)
        request.onsuccess = () => {
          request.result.close()
          resolve(wasBlocked)
        }
        request.onerror = () => reject(request.error)
      }),
    aNewerFartysVersion
  )
  expect(blocked).toBe(false)
})

test('says Farty was updated when a newer Farty saved the library', async ({ page }) => {
  await beforeFartyOpens(page)
  await write(page, [], { ...beforeToots, version: aNewerFartysVersion })

  await page.goto('/recordings/')
  await expect(page.getByText('Farty was updated')).toBeVisible()
  await expect(page.getByText('Your library was saved by a newer version of Farty.')).toBeVisible()
  expect((await layout(page)).version).toBe(aNewerFartysVersion)
})
