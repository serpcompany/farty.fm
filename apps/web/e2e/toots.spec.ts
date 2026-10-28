import type { Page } from '@playwright/test'
import { newEmail, signInByApi } from './account'
import { all, keys, write } from './database'
import { expectTappable, literally, tab } from './screens'
import { loadTheFixtureLibrary, makeAToot, needsTheFixtureLibrary, song } from './songs'
import { forgetSounds, lastSound, soundsStarted } from './sounds'
import { expect, test } from './test'
import { listenToTheToots, type StoredToot, tootOf } from './toots'

needsTheFixtureLibrary()
test.use({ serviceWorkers: 'block' })

const mary = song('mary')
const twinkle = song('twinkle')

async function deleteTootAudio(page: Page, songId: string): Promise<void> {
  const { id } = await tootOf(page, songId)
  await write(page, [{ store: 'tootAudio', key: id }])
}

async function breakTheStore(page: Page, method: 'get' | 'put', store: string) {
  await page.evaluate(
    ({ method, store }) => {
      const broken = window as unknown as { pedosBroken: number; pedosMend: () => void }
      broken.pedosBroken = 0
      type Method = (this: IDBObjectStore, ...args: unknown[]) => IDBRequest
      const prototype = IDBObjectStore.prototype as unknown as Record<typeof method, Method>
      const original = prototype[method]
      prototype[method] = function (...args) {
        if (this.name !== store) return original.apply(this, args)
        broken.pedosBroken += 1
        if (method === 'get') throw new DOMException('Broken for the test', 'UnknownError')
        const request = original.apply(this, args)
        this.transaction.abort()
        return request
      }
      broken.pedosMend = () => {
        prototype[method] = original
      }
    },
    { method, store }
  )
}

function timesBroken(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { pedosBroken: number }).pedosBroken)
}

async function mendTheStore(page: Page) {
  await page.evaluate(() => (window as unknown as { pedosMend: () => void }).pedosMend())
}

test("a Toot whose audio is gone says so, and can't play; one the store fails for a moment is kept", async ({
  page,
  context
}, testInfo) => {
  test.setTimeout(180_000)
  await listenToTheToots(context)
  await page.goto('/profile/')
  await signInByApi(page, newEmail(testInfo, 'gone'))
  await page.reload()
  await loadTheFixtureLibrary(page)
  await makeAToot(page, mary.id)
  await makeAToot(page, twinkle.id)
  await tab(page, 'Toots').click()
  await expect(page.getByTestId('toot-row')).toHaveCount(2)
  const twinkleDetails = page.getByTestId('toot-row').nth(0).getByTestId('toot-details')

  await breakTheStore(page, 'get', 'tootAudio')
  await page.getByRole('button', { name: `Play ${twinkle.title}` }).click()
  await expect(twinkleDetails).toHaveText(`${twinkle.title} · Couldn't play`)
  expect(await timesBroken(page)).toBe(1)
  await page.getByRole('button', { name: `Play ${twinkle.title}` }).click()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await mendTheStore(page)
  await page.getByRole('button', { name: `Play ${twinkle.title}` }).click()
  expect((await lastSound(page)).duration).toBeGreaterThan(5)
  await expect(twinkleDetails).toHaveText(new RegExp(`^${literally(twinkle.title)} · Today`))
  await page.getByRole('button', { name: `Stop ${twinkle.title}` }).click()

  await page.getByRole('link', { name: new RegExp(`^${literally(twinkle.title)}`) }).click()
  const state = page.getByTestId('song-creator-state')
  await expect(state).toHaveText('Ready')
  await breakTheStore(page, 'get', 'tootAudio')
  await page.getByTestId('song-creator-play').click()
  await expect(state).toHaveText("Couldn't play")
  await mendTheStore(page)
  await page.getByTestId('song-creator-play').click()
  await expect(state).toHaveText('Playing')
  await page.getByRole('link', { name: 'Back to Toots' }).click()
  expect(await keys(page, 'tootAudio')).toHaveLength(2)

  await breakTheStore(page, 'put', 'toots')
  await page.getByRole('button', { name: `More for ${mary.title}` }).click()
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  await page.getByRole('alertdialog').getByRole('textbox', { name: 'Name' }).fill('Not kept')
  await page.getByRole('alertdialog').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('toot-row').nth(1).getByRole('link')).toContainText('Not kept')
  await expect.poll(() => timesBroken(page)).toBe(1)
  await mendTheStore(page)

  await deleteTootAudio(page, twinkle.id)
  await page.getByRole('button', { name: `Play ${twinkle.title}` }).click()
  await expect(page.getByTestId('toot-row').nth(0).getByTestId('toot-details')).toHaveText(
    `${twinkle.title} · Audio missing`
  )

  await deleteTootAudio(page, mary.id)
  await page.reload()
  const row = page.getByTestId('toot-row').nth(1)
  await expect(row.getByRole('link')).toHaveText(`${mary.title}${mary.title} · Audio missing`)
  await forgetSounds(page)
  const play = page.getByRole('button', { name: `${mary.title}: audio missing` })
  await expectTappable(play)
  await play.click()
  const alert = page.getByRole('alertdialog', { name: "This Toot's audio is missing" })
  await expect(alert).toContainText(
    "It can't be played. You can delete it and make it again in Compose."
  )
  await expectTappable(alert.getByRole('button', { name: 'Cancel' }))
  await expectTappable(alert.getByRole('button', { name: 'Delete' }))
  await alert.getByRole('button', { name: 'Cancel' }).click()
  await expect(alert).toBeHidden()

  await row.getByRole('link').click()
  await expect(page.getByTestId('toot-audio-missing')).toHaveText(
    "This Toot's audio is missing. You can delete it and make it again in Compose."
  )
  await expect(page.getByTestId('song-creator-state')).toHaveText('Audio missing')
  await expect(page.getByRole('button', { name: 'Audio missing' })).toBeDisabled()
  await page.getByTestId('note-view').click()
  await expect(page.getByTestId('note-caption')).toHaveCount(0)
  expect(await soundsStarted(page)).toBe(0)

  await page.getByRole('link', { name: 'Back to Toots' }).click()
  await page.getByRole('button', { name: `${mary.title}: audio missing` }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByTestId('toot-row')).toHaveCount(1)
  expect((await all<StoredToot>(page, 'toots')).map(t => t.songId)).toEqual([twinkle.id])
  expect(await keys(page, 'tootAudio')).toEqual([])
})

test("Toots that fail to load, and a Toot that isn't there, say so", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pedos.welcomed', '1')
    IDBObjectStore.prototype.getAllKeys = () => {
      throw new DOMException('Broken for the test', 'UnknownError')
    }
  })
  await page.goto('/toots/')
  await expect(page.getByText("Couldn't load your Toots.")).toBeVisible()
  await page.goto('/toots/toot/?id=not-a-toot')
  await expect(page.getByText("Couldn't load your Toots.")).toBeVisible()

  const fresh = await page.context().newPage()
  await fresh.addInitScript(() => localStorage.setItem('pedos.welcomed', '1'))
  await fresh.goto('/toots/toot/?id=not-a-toot')
  await expect(fresh.getByText("Couldn't find this Toot.")).toBeVisible()
  await fresh.getByRole('link', { name: 'Back to Toots' }).click()
  await expect(fresh).toHaveURL(/\/toots\/$/)
  await expect(fresh.getByText('Nothing yet')).toBeVisible()
})
