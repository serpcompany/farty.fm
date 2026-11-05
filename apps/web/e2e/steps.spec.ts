import { expect, type Page, test } from '@playwright/test'
import { codeFor, newEmail, ownClient } from './account'
import {
  fakeMicrophone,
  fartAndRecord,
  fixtureWavs,
  getUserMediaMs,
  waitForOpenMicrophone
} from './fake-microphone'
import { skipWelcome } from './record'

// The funnel's steps (#405): what a new phone's browser sends to /api/steps/. Each step goes once,
// across reloads and a new visit, and nothing but its name. A browser from before this shipped,
// one under Global Privacy Control and anything wider than a phone send none. What the server does
// with them is in `steps.workers.test.ts`.

test.use({ permissions: ['microphone'] })

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'Welcome, where a new visitor starts, is phone-only')
  await page.addInitScript(fakeMicrophone, { wavs: fixtureWavs(), delayMs: getUserMediaMs })
})

/** Every step this page sends, from now on, with what else its body held. */
function stepsFrom(page: Page): string[] {
  const sent: string[] = []
  page.on('request', request => {
    if (new URL(request.url()).pathname !== '/api/steps/') return
    const { step, ...rest } = request.postDataJSON() as { step: string }
    expect(rest).toEqual({})
    sent.push(step)
  })
  return sent
}

/** Waits long enough for a step the page would send to have gone, across a navigation too. */
const aMoment = (page: Page) => page.waitForTimeout(500)

function tab(page: Page, label: string) {
  return page
    .getByRole('navigation', { name: 'Tabs' })
    .getByRole('link', { name: label, exact: true })
}

test('a new phone counts open, the microphone and its first Recording, each once', async ({
  page
}) => {
  const sent = stepsFrom(page)
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Allow microphone' })).toBeVisible()
  await expect.poll(() => [...sent]).toEqual(['open'])

  await page.reload()
  await expect(page.getByRole('button', { name: 'Allow microphone' })).toBeVisible()
  await aMoment(page)
  expect(sent).toEqual(['open'])

  await page.getByRole('button', { name: 'Allow microphone' }).click()
  await expect.poll(() => [...sent]).toEqual(['open', 'mic-allowed'])

  await waitForOpenMicrophone(page)
  await fartAndRecord(page, '095')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('result-note')).toBeVisible()
  await expect.poll(() => [...sent]).toEqual(['open', 'mic-allowed', 'first-recording'])

  // A new visit, in a new tab, keeps what's been counted, though a guest's farts go.
  const nextVisit = await page.context().newPage()
  await page.close()
  await nextVisit.addInitScript(fakeMicrophone, { wavs: fixtureWavs(), delayMs: getUserMediaMs })
  const sentNext = stepsFrom(nextVisit)
  await nextVisit.goto('/')
  await waitForOpenMicrophone(nextVisit)
  await fartAndRecord(nextVisit, '095')
  await nextVisit.getByRole('button', { name: 'Save' }).click()
  await expect(nextVisit.getByTestId('result-note')).toBeVisible()
  await aMoment(nextVisit)
  expect(sentNext).toEqual([])
})

test('a reload while a step is on its way doesn’t send it again', async ({ page }) => {
  const sent = stepsFrom(page)
  // Held, so the reload cuts it off.
  await page.route('**/api/steps/', async route => {
    await new Promise(resolve => setTimeout(resolve, 1_000))
    await route.continue().catch(() => {})
  })
  const allow = page.getByRole('button', { name: 'Allow microphone' })
  await page.goto('/')
  await expect(allow).toBeVisible()
  await expect.poll(() => [...sent]).toEqual(['open'])

  await page.reload()
  await expect(allow).toBeVisible()
  await page.waitForTimeout(1_500)
  expect(sent).toEqual(['open'])
})

test('hearing a Song, tapping Save and signing in count, once each', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  await ownClient(page.context())
  await page.addInitScript(skipWelcome)
  // Counted its open already.
  await page.addInitScript(() => {
    if (localStorage.getItem('pedos.steps') === null) {
      localStorage.setItem('pedos.steps', JSON.stringify({ open: 'sent' }))
    }
  })
  const sent = stepsFrom(page)

  // Four takes unlock Mary, as in `compose.spec.ts`.
  await page.goto('/')
  for (const id of ['095', '017', '022', '002']) {
    await waitForOpenMicrophone(page)
    await fartAndRecord(page, id)
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('result-note')).toBeVisible()
    if (id === '002') break
    if (id === '022') {
      await page.getByRole('button', { name: 'Done' }).click()
      await tab(page, 'Record').click()
    } else await page.getByRole('button', { name: 'Record another' }).click()
  }
  await page.getByRole('button', { name: 'Done' }).click()
  await expect.poll(() => [...sent]).toEqual(['mic-allowed', 'first-recording'])

  await tab(page, 'Compose').click()
  await page.getByTestId('unlocked-songs').locator('[data-song="mary"]').getByRole('link').click()
  await expect(page.getByTestId('song-creator-state')).toBeVisible({ timeout: 60_000 })

  const play = page.getByTestId('song-creator-play')
  await expect(play).toBeEnabled({ timeout: 60_000 })
  // The Toot plays by itself once it's made: heard, with no tap on Play.
  await expect.poll(() => [...sent]).toContain('song-heard')
  await expect(play).toHaveAccessibleName('Stop')
  await play.click()
  await play.click()

  // A guest's Save opens the account step, and has still been tapped.
  await page.getByRole('button', { name: 'Save to Toots' }).click()
  await expect.poll(() => [...sent]).toContain('save-tapped')

  const email = newEmail(testInfo, 'steps')
  const step = page.getByRole('dialog', { name: 'Keep your farts' })
  await step.getByLabel('Email').fill(email)
  await step.getByRole('button', { name: 'Send code' }).click()
  await step.getByLabel('Code').fill(await codeFor(page, email))
  await step.getByRole('button', { name: 'Sign in' }).click()
  await expect.poll(() => [...sent]).toContain('account')
  await aMoment(page)
  for (const once of ['song-heard', 'save-tapped', 'account']) {
    expect(sent.filter(step => step === once)).toHaveLength(1)
  }
})

test('a browser from before the counts counts nothing', async ({ page }) => {
  const sent = stepsFrom(page)
  await page.addInitScript(skipWelcome)
  await page.goto('/')
  await waitForOpenMicrophone(page)
  await fartAndRecord(page, '095')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('result-note')).toBeVisible()
  await aMoment(page)
  expect(sent).toEqual([])
})

test('Global Privacy Control counts nothing', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true })
  )
  const sent = stepsFrom(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Allow microphone' }).click()
  await waitForOpenMicrophone(page)
  await aMoment(page)
  expect(sent).toEqual([])
})

test('wider than a phone counts nothing', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  const sent = stepsFrom(page)
  await page.goto('/')
  await aMoment(page)
  expect(sent).toEqual([])
})
