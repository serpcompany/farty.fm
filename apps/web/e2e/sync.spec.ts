import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import type { BrowserContext, Page } from '@playwright/test'
import { newEmail, signInByApi } from './account'
import { all, bytes, stored, uploaded } from './database'
import { g3Fart, recordG3, skipWelcome, withFakeMicrophone } from './record'
import { comeBack, onPhone, tab } from './screens'
import { loadTheFixtureLibrary, makeAToot, needsTheFixtureLibrary, song } from './songs'
import { hearSounds, lastSound } from './sounds'
import { expect, test } from './test'

withFakeMicrophone(g3Fart)
needsTheFixtureLibrary()
test.skip(({ viewport }) => !onPhone({ viewport }), 'Sync is checked at phone size')
test.use({ serviceWorkers: 'block' })

const mary = song('mary')
const twinkle = song('twinkle')

async function twoBrowsers(context: BrowserContext, other: BrowserContext) {
  for (const browserContext of [context, other]) {
    await browserContext.addInitScript(skipWelcome)
    await browserContext.addInitScript(hearSounds)
  }
  return [await context.newPage(), await other.newPage()]
}

function recordingRow(page: Page, number: number) {
  return page.getByRole('button', { name: new RegExp(`^Recording ${number}, `) })
}

async function wavDigest(page: Page, store: 'audio' | 'tootAudio', name: string) {
  const items =
    store === 'audio'
      ? (await all<{ id: string; number: number }>(page, 'recordings')).map(r => ({
          id: r.id,
          name: `Recording ${r.number}`
        }))
      : (await all<{ id: string; title: string }>(page, 'toots')).map(t => ({
          id: t.id,
          name: t.title
        }))
  const id = items.find(item => item.name === name)?.id
  const wav = id && (await bytes(page, store, id))
  if (!wav) return `no audio for ${name}`
  return `${wav.byteLength} bytes, ${createHash('sha256').update(wav).digest('hex')}`
}

async function playsTheOthers(
  page: Page,
  other: Page,
  store: 'audio' | 'tootAudio',
  name: string,
  { atLeast }: { atLeast: number }
) {
  const sound = await lastSound(page)
  expect(sound.duration).toBeGreaterThan(atLeast)
  expect(sound.peak).toBeGreaterThan(0.05)
  const wav = await wavDigest(page, store, name)
  expect(wav).toBe(await wavDigest(other, store, name))
  return { duration: sound.duration, peak: sound.peak, wav }
}

async function deleteTheToot(page: Page, title: string) {
  await page.getByRole('button', { name: `More for ${title}` }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await page
    .getByRole('alertdialog', { name: `Delete ${title}?` })
    .getByRole('button', { name: 'Delete Toot' })
    .click()
}

test("two browsers signed in to one account play each other's farts, and see each other's deletes", async ({
  context,
  newContext
}, testInfo) => {
  test.setTimeout(300_000)
  const email = newEmail(testInfo, 'sync')
  const [a, b] = await twoBrowsers(context, await newContext())
  let recordings = 0
  const heard: Record<string, unknown> = {}

  await test.step('A signs in, loads the Fixture Library, makes a Toot, and uploads them', async () => {
    await a.goto('/profile/')
    await signInByApi(a, email)
    await a.goto('/profile/')
    await expect(a.getByTestId('account-email')).toHaveText(email)
    await loadTheFixtureLibrary(a)
    recordings = Number(
      (await a.getByTestId('fixture-library-count').textContent())?.split(' of ')[1]
    )
    expect(recordings).toBeGreaterThan(0)
    await makeAToot(a, mary.id)
    await uploaded(a)
  })

  await test.step("B signs in to the same account, and plays A's Recording and Toot", async () => {
    await b.goto('/profile/')
    await signInByApi(b, email)
    await b.goto('/recordings/')
    await expect(b.getByTestId('recording-row')).toHaveCount(recordings)
    await recordingRow(b, 1).click()
    heard["B, A's Recording 1"] = await playsTheOthers(b, a, 'audio', 'Recording 1', {
      atLeast: 0.1
    })

    await tab(b, 'Toots').click()
    await b.getByRole('button', { name: `Play ${mary.title}` }).click()
    heard[`B, A's Toot ${mary.title}`] = await playsTheOthers(b, a, 'tootAudio', mary.title, {
      atLeast: 5
    })
    await b.getByRole('button', { name: `Stop ${mary.title}` }).click()
  })

  const recorded = `Recording ${recordings + 1}`

  await test.step('B records a fart and makes a Toot, which A plays once it opens again', async () => {
    await recordG3(b)
    await b.getByRole('button', { name: 'Done' }).click()
    await expect(recordingRow(b, recordings + 1)).toBeVisible()
    await makeAToot(b, twinkle.id)
    await uploaded(b)

    await a.goto('/recordings/')
    await expect(a.getByTestId('recording-row')).toHaveCount(recordings + 1)
    await a.getByRole('button', { name: new RegExp(`^${recorded}, \\d+\\.\\d s, G3$`) }).click()
    heard[`A, B's ${recorded}`] = await playsTheOthers(a, b, 'audio', recorded, { atLeast: 1 })

    await tab(a, 'Toots').click()
    await expect(a.getByTestId('toot-row')).toHaveCount(2)
    await a.getByRole('button', { name: `Play ${twinkle.title}` }).click()
    heard[`A, B's Toot ${twinkle.title}`] = await playsTheOthers(a, b, 'tootAudio', twinkle.title, {
      atLeast: 5
    })
    await a.getByRole('button', { name: `Stop ${twinkle.title}` }).click()
  })

  await test.step("A deletes B's Toot, and it's gone from B once B comes back to Farty", async () => {
    await tab(b, 'Toots').click()
    await expect(b.getByTestId('toot-row')).toHaveCount(2)
    await deleteTheToot(a, twinkle.title)
    await expect(a.getByTestId('toot-row')).toHaveCount(1)
    await uploaded(a)

    await comeBack(b)
    await expect(b).toHaveURL(/:\d+\/$/)
    await tab(b, 'Toots').click()
    await expect(b.getByTestId('toot-row')).toHaveCount(1)
    await expect(b.getByRole('button', { name: `Play ${mary.title}` })).toBeVisible()
    expect(await stored(b, 'toots')).toBe(1)
  })

  await test.step('A renames a Toot, and B shows the new name once it comes back, without a reload', async () => {
    const renamed = 'Lamb, from A'
    await a.getByRole('button', { name: `More for ${mary.title}` }).click()
    await a.getByRole('menuitem', { name: 'Rename' }).click()
    const dialog = a.getByRole('alertdialog', { name: 'Rename' })
    await dialog.getByRole('textbox', { name: 'Name' }).fill(renamed)
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(a.getByRole('button', { name: `Play ${renamed}` })).toBeVisible()
    await uploaded(a)

    await comeBack(b)
    await expect(b).toHaveURL(/:\d+\/$/)
    await tab(b, 'Toots').click()
    await expect(b.getByRole('button', { name: `Play ${renamed}` })).toBeVisible()
    await expect(b.getByTestId('toot-row')).toHaveCount(1)
  })

  await test.step("B deletes A's Recording, and it's gone from A once A comes back, and after a reload", async () => {
    await tab(b, 'Recordings').click()
    await tab(a, 'Recordings').click()
    await b.getByRole('button', { name: 'Delete Recording 1', exact: true }).click()
    await b.getByRole('alertdialog').getByRole('button', { name: 'Delete Recording' }).click()
    await expect(b.getByTestId('recording-row')).toHaveCount(recordings)
    await uploaded(b)

    await comeBack(a)
    await expect(a).toHaveURL(/:\d+\/$/)
    await tab(a, 'Recordings').click()
    await expect(a.getByTestId('recording-row')).toHaveCount(recordings)
    await expect(recordingRow(a, 1)).toHaveCount(0)
    await a.reload()
    await expect(a.getByTestId('recording-row')).toHaveCount(recordings)
    expect(await stored(a, 'recordings')).toBe(recordings)
    await a.screenshot({ path: testInfo.outputPath('a-recordings.png') })
  })

  writeFileSync(testInfo.outputPath('heard.json'), JSON.stringify(heard, null, 2))
})

test("a guest's Recording joins the account numbered after the account's, in both browsers", async ({
  context,
  newContext
}, testInfo) => {
  test.setTimeout(180_000)
  const email = newEmail(testInfo, 'numbers')
  const [a, b] = await twoBrowsers(context, await newContext())

  await test.step('A signs in and records Recording 1', async () => {
    await a.goto('/')
    await signInByApi(a, email)
    await recordG3(a)
    await a.getByRole('button', { name: 'Done' }).click()
    await expect(recordingRow(a, 1)).toBeVisible()
    await uploaded(a)
  })

  await test.step('B records as a guest, its own Recording 1, then signs in to the account', async () => {
    await recordG3(b)
    await b.getByRole('button', { name: 'Done' }).click()
    await expect(recordingRow(b, 1)).toBeVisible()
    await signInByApi(b, email)
    await b.reload()
    await expect(b.getByTestId('recording-row')).toHaveCount(2)
    await expect(recordingRow(b, 1)).toHaveCount(1)
    await expect(recordingRow(b, 2)).toHaveCount(1)
    await uploaded(b)
    await b.screenshot({ path: testInfo.outputPath('b-numbers.png') })
  })

  await test.step('A shows the two Recordings, numbered 1 and 2', async () => {
    await comeBack(a)
    await tab(a, 'Recordings').click()
    await expect(a.getByTestId('recording-row')).toHaveCount(2)
    await expect(recordingRow(a, 1)).toHaveCount(1)
    await expect(recordingRow(a, 2)).toHaveCount(1)
    await a.reload()
    await expect(recordingRow(a, 1)).toHaveCount(1)
    await expect(recordingRow(a, 2)).toHaveCount(1)
  })
})
