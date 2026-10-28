import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { reopen } from './account'
import { persistAsked, standInForPersist, stored, write } from './database'
import { g3Fart, recordAndSave, recordG3ToRecordings, withFartingMicrophone } from './record'
import { onPhone, tab } from './screens'
import {
  controlledByTheServiceWorker,
  errorsWhileOffline,
  needsTheServiceWorker
} from './service-worker'
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

async function saveATootHere(page: Page) {
  const id = crypto.randomUUID()
  await write(page, [
    { store: 'toots', value: marysToot(id) },
    { store: 'tootAudio', bytes: Buffer.alloc(44).toString('base64'), key: id },
    {
      store: 'outbox',
      value: {
        key: `toots:${id}`,
        kind: 'toots',
        id,
        op: 'put',
        sent: false,
        queuedAt: Date.now(),
        version: crypto.randomUUID()
      }
    }
  ])
  await page.goto('/toots/')
  await expect(page.getByTestId('toot-row')).toHaveCount(1)
}

async function expectARecordingThatPlays(page: Page) {
  await expect(page.getByTestId('recording-row')).toHaveCount(1)
  const row = page.getByRole('button', { name: /^Recording 1, \d+\.\d s, G3$/ })
  await row.click()
  await expect(row).toHaveAttribute('aria-pressed', 'true')
}

test("a guest's Recording outlasts closing Farty and still plays, while their Toot lasts the visit", async ({
  page,
  context
}) => {
  await context.addInitScript(standInForPersist)
  await recordG3ToRecordings(page)
  await expect.poll(() => persistAsked(page)).toBe(true)
  await saveATootHere(page)

  await page.reload()
  await expect(page.getByTestId('toot-row')).toHaveCount(1)
  const second = await context.newPage()
  await second.goto('/toots/')
  await expect(second.getByTestId('toot-row')).toHaveCount(1)
  await second.close()

  const reopened = await reopen(context, page)
  await expectARecordingThatPlays(reopened)
  expect(await stored(reopened, 'toots')).toBe(0)
  expect(await stored(reopened, 'tootAudio')).toBe(0)
  expect(await stored(reopened, 'outbox')).toBe(1)
  await tab(reopened, 'Toots').click()
  await expect(reopened.getByText('Nothing yet')).toBeVisible()

  await expectARecordingThatPlays(await reopen(context, reopened))
})

test("a guest's Recording is there when the installed app opens again offline", async ({
  page,
  context,
  pageErrors
}) => {
  needsTheServiceWorker()
  pageErrors.expect(...errorsWhileOffline)
  await recordG3ToRecordings(page)
  await controlledByTheServiceWorker(page)

  const online = await reopen(context, page)
  await expectARecordingThatPlays(online)
  await context.setOffline(true)
  const offline = await reopen(context, online)
  await expectARecordingThatPlays(offline)
  await context.setOffline(false)
})

test("a browser's farts from before a guest's Toots lasted the visit: the Recording stays, the Toot goes after this visit", async ({
  page,
  context
}) => {
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
  const reopened = await reopen(context, page)
  await expect(reopened.getByTestId('recording-row')).toHaveCount(1)
  expect(await stored(reopened, 'toots')).toBe(0)
  await tab(reopened, 'Toots').click()
  await expect(reopened.getByText('Nothing yet')).toBeVisible()
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
