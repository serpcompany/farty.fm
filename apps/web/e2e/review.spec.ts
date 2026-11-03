import { expect, type Page, test } from '@playwright/test'
import { newEmail, signInByApi } from './account'
import { skipWelcome, withFakeMicrophone } from './record'

// A take's review (#314): after Stop, the take is trimmed, given another note and a name, and
// saved; the Recordings tab, a reload and the account all keep them. Fixture 090 is Melodic: its
// golden Recording Pitch is G3 (+13 cents).
withFakeMicrophone('090__carlosramon__17-pet__186119.wav')

test('a take trimmed, moved to another note and named in its review keeps them', async ({
  page
}, testInfo) => {
  test.setTimeout(120_000)
  await page.addInitScript(skipWelcome, {})
  await page.goto('/profile/')
  await signInByApi(page, newEmail(testInfo, 'review'))

  await page.goto('/')
  await page.getByTestId('record-button').click()
  await expect(page.getByTestId('recording-timer')).toBeVisible()
  await page.waitForTimeout(1500)
  await page.getByTestId('stop-button').click()
  const review = page.getByRole('dialog', { name: 'New Recording' })

  // Analysis runs from Stop: the note and the fart it finds show on the review.
  await expect(review.getByTestId('review-note')).toHaveText('G3', { timeout: 30_000 })
  await expect(review.getByTestId('review-caption')).toHaveText(
    'We heard G3. Tap a key to hear it and make it the note.'
  )
  const length = review.getByTestId('review-length')
  const handlesApart = async () => Number.parseFloat(await length.innerText())
  const found = await handlesApart()

  // Trim: the end pulled in 0.2 s.
  const end = review.getByRole('slider', { name: 'Where the fart ends' })
  for (let i = 0; i < 2; i++) await end.press('Shift+ArrowLeft')
  await expect.poll(handlesApart).toBeCloseTo(found - 0.2, 1)
  const trimmed = await handlesApart()

  // Another note: A3, with the way back to G3.
  await review.getByRole('button', { name: 'A3', exact: true }).click()
  await expect(review.getByTestId('review-note')).toHaveText('A3')
  await expect(review.getByTestId('review-caption')).toHaveText('Changed from G3. Back to G3')

  // A name.
  await expect(review.getByRole('textbox', { name: 'Name' })).toHaveValue('Recording 1')
  await review.getByRole('textbox', { name: 'Name' }).fill('Big One')

  await review.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('result-note')).toHaveText('A3')
  await page.getByRole('button', { name: 'Done' }).click()

  // The Recordings tab, before and after a reload.
  const row = page.getByTestId('recording-row')
  const shows = async () => {
    await expect(row).toHaveCount(1)
    await expect(
      page.getByRole('button', { name: /^Big One, \d+\.\d s, A3, placed by ear, trimmed$/ })
    ).toBeVisible()
    await expect(page.getByTestId('recording-note')).toHaveText('A3')
    await expect(row).toContainText('Placed by ear')
    await expect(row).toContainText('Trimmed')
    // The row shows the length of the fart between the handles, rounded down to a tenth.
    const shown = Number.parseFloat(await page.getByTestId('recording-length').innerText())
    expect(shown).toBeLessThanOrEqual(trimmed + 1e-9)
    expect(shown).toBeLessThan(found - 0.1)
  }
  await shows()
  await expect.poll(() => outbox(page), { timeout: 60_000 }).toBe(0)
  await page.reload()
  await shows()

  // Its review opens on what was saved.
  await page.getByRole('button', { name: 'Edit Big One' }).click()
  const saved = page.getByRole('dialog', { name: 'Big One' })
  await expect(saved.getByTestId('review-note')).toHaveText('A3')
  await expect(saved.getByRole('textbox', { name: 'Name' })).toHaveValue('Big One')
  await expect(saved.getByTestId('review-length')).toHaveText(`${trimmed.toFixed(2)} s`)
  await saved.getByRole('button', { name: 'Cancel' }).click()
  await expect(saved).toBeHidden()

  // The account keeps them too.
  const [recording] = await library(page)
  expect(recording).toMatchObject({ name: 'Big One', placedPitch: 57 })
  expect(recording?.trim).not.toBeNull()
})

/** How many changes wait in the outbox to upload. */
function outbox(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('pedos')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const count = await new Promise<number>((resolve, reject) => {
      const request = db.transaction('outbox').objectStore('outbox').count()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return count
  })
}

type Kept = { name?: string; placedPitch?: number; trim?: unknown }

/** The account's Recordings, as the server keeps them. */
function library(page: Page): Promise<Kept[]> {
  return page.evaluate(async () => {
    const session: { user: { id: string } } = await (await fetch('/api/auth/get-session')).json()
    const response = await fetch('/api/library/', {
      headers: { 'x-pedos-library': session.user.id },
      cache: 'no-store'
    })
    const library: { recordings: Kept[] } = await response.json()
    return library.recordings
  })
}
