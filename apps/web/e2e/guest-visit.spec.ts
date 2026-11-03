import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { newEmail, reopen, signInByApi } from './account'
import { persistAsked, standInForPersist, stored, uploaded, write } from './database'
import {
  g3Fart,
  recordAndSave,
  recordG3,
  recordG3ToRecordings,
  withFartingMicrophone
} from './record'
import { onPhone, tab } from './screens'
import {
  controlledByTheServiceWorker,
  errorsWhileOffline,
  needsTheServiceWorker
} from './service-worker'
import { loadTheFixtureLibrary, needsTheFixtureLibrary, openASong } from './songs'
import { expect, test } from './test'

withFartingMicrophone()
test.skip(({ viewport }) => !onPhone({ viewport }), 'The account step is checked at phone size')

const audio = () =>
  readFileSync(resolve(__dirname, '../../../fixtures/recordings', g3Fart)).toString('base64')

const marysToot = (id: string) => ({
  id,
  title: 'Mary Had a Little Lamb',
  songId: 'mary',
  createdAt: Date.now(),
  seconds: 1,
  arrangement: { transposition: 0, recordingForPitch: {} }
})

async function expectARecordingThatPlays(page: Page) {
  await expect(page.getByTestId('recording-row')).toHaveCount(1)
  const row = page.getByRole('button', { name: /^Recording 1, \d+\.\d s, G3$/ })
  await row.click()
  await expect(row).toHaveAttribute('aria-pressed', 'true')
}

test.describe('with the Fixture Library', () => {
  needsTheFixtureLibrary()

  test("a guest's farts last the visit: they record and hear a Song, and Farty opens again with none", async ({
    page,
    context
  }) => {
    test.setTimeout(180_000)
    await context.addInitScript(standInForPersist)
    await recordG3ToRecordings(page)
    await tab(page, 'Profile').click()
    await loadTheFixtureLibrary(page)
    await openASong(page, 'mary')
    const farts = await stored(page, 'recordings')
    expect(farts).toBeGreaterThan(1)
    expect(await persistAsked(page)).toBe(false)

    await page.goto('/recordings/')
    await page.reload()
    await expect(page.getByTestId('recording-row')).toHaveCount(farts)
    const second = await context.newPage()
    await second.goto('/recordings/')
    await expect(second.getByTestId('recording-row')).toHaveCount(farts)
    await second.close()

    const reopened = await reopen(context, page)
    await expect(reopened.getByText('No Recordings yet')).toBeVisible()
    for (const store of ['recordings', 'audio', 'toots', 'tootAudio', 'outbox']) {
      expect(await stored(reopened, store)).toBe(0)
    }
  })
})

test("an account's Recording is there when the installed app opens again offline", async ({
  page,
  context,
  pageErrors
}, testInfo) => {
  needsTheServiceWorker()
  test.setTimeout(120_000)
  pageErrors.expect(...errorsWhileOffline)
  await recordG3ToRecordings(page)
  await signInByApi(page, newEmail(testInfo, 'offline'))
  await page.reload()
  await uploaded(page)
  await controlledByTheServiceWorker(page)

  const online = await reopen(context, page)
  await expectARecordingThatPlays(online)
  await context.setOffline(true)
  const offline = await reopen(context, online)
  await expectARecordingThatPlays(offline)
  await context.setOffline(false)
})

test("a guest's Recordings from before #237 stay, while their Toot and their new Recordings go after this visit", async ({
  page,
  context
}) => {
  test.setTimeout(120_000)
  await page.goto('/robots.txt')
  await write(
    page,
    [
      {
        store: 'recordings',
        value: {
          id: 'from-before',
          number: 1,
          createdAt: Date.now(),
          seconds: 1,
          sampleRate: 44100,
          waveform: [],
          analysis: { state: 'notAnalyzed' }
        }
      },
      { store: 'audio', bytes: audio(), key: 'from-before' },
      { store: 'toots', value: { ...marysToot('toot-from-before'), title: 'From before' } },
      { store: 'tootAudio', bytes: audio(), key: 'toot-from-before' }
    ],
    { version: 2, stores: { recordings: 'id', audio: null, toots: 'id', tootAudio: null } }
  )

  await page.goto('/toots/')
  await expect(page.getByTestId('toot-row')).toHaveCount(1)
  expect(await page.evaluate(() => localStorage.getItem('pedos.keptRecordings'))).toBe(
    '["from-before"]'
  )
  expect(await page.evaluate(() => localStorage.getItem('pedos.accountStep'))).toBeNull()
  const reopened = await reopen(context, page)
  await expect(reopened.getByTestId('recording-row')).toHaveCount(1)
  expect(await stored(reopened, 'toots')).toBe(0)
  await tab(reopened, 'Toots').click()
  await expect(reopened.getByText('Nothing yet')).toBeVisible()

  await recordG3(reopened)
  expect(await stored(reopened, 'recordings')).toBe(2)
  const again = await reopen(context, reopened)
  await expect(again.getByTestId('recording-row')).toHaveCount(1)
  expect(await stored(again, 'recordings')).toBe(1)
  expect(await stored(again, 'audio')).toBe(1)
})

test.describe('with a microphone that answers at once', () => {
  test.use({ fakeMicrophone: { farts: true, answersAfterMs: 0 } })

  test('a Recording saved while Farty still reads the session waits for the visit to start', async ({
    page,
    context
  }) => {
    await page.goto('/recordings/')
    await expect(page.getByText('No Recordings yet')).toBeVisible()
    await write(page, [{ store: 'meta', value: 1, key: 'cursor' }])
    await page.close()
    const visit = await context.newPage()

    let answer = () => {}
    const answered = new Promise<void>(resolve => (answer = resolve))
    await visit.route('**/api/auth/get-session*', async route => {
      await answered
      await route.continue()
    })
    await recordAndSave(visit)
    await expect(visit.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(await stored(visit, 'recordings')).toBe(0)
    answer()
    await expect(visit.getByTestId('result-note')).toHaveText('G3')
    expect(await stored(visit, 'recordings')).toBe(1)
    expect(await stored(visit, 'meta')).toBe(0)
  })
})
