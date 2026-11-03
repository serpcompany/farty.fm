import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { newEmail, signInByApi } from './account'
import { bytes, uploaded } from './database'
import { payToSave } from './pay'
import { skipWelcome } from './record'
import {
  expectALinkPreview,
  expectANewLiveLink,
  expectGone,
  expectItPlays,
  expectNothingPrivate,
  expectUncached,
  fakeShareSheet,
  linkPattern,
  meta,
  newHandle,
  pickAHandle,
  reportIt,
  sharedLink,
  shareSheet,
  someoneSignedOut
} from './sharing'
import { loadTheFixtureLibrary, needsTheFixtureLibrary, song } from './songs'
import { expect, test } from './test'

const evidence = process.env.E2E_EVIDENCE_DIR ? resolve(process.env.E2E_EVIDENCE_DIR) : null
const twinkle = song('twinkle').title

needsTheFixtureLibrary()
test.use({ serviceWorkers: 'block' })

test('a signed-in user shares a saved Toot, someone signed out plays it, and Stop sharing takes the link down', async ({
  context,
  newContext,
  pageErrors
}, testInfo) => {
  test.setTimeout(300_000)
  pageErrors.expect('the server responded with a status of 404')
  const out = evidence && join(evidence, testInfo.project.name)
  if (out) mkdirSync(out, { recursive: true })
  const shot = async (on: Page, name: string) => {
    if (out) await on.screenshot({ path: join(out, `${name}.png`), animations: 'disabled' })
  }
  const handle = newHandle()
  await fakeShareSheet(context)
  await context.addInitScript(skipWelcome)
  const page = await context.newPage()
  const shared = async () => (await shareSheet(page)).length
  let tootId = ''
  let title = ''
  let link = ''
  const email = newEmail(testInfo, 'share-toot')

  await test.step(`signs in and saves a Toot of ${twinkle}`, async () => {
    await page.goto('/profile/')
    await signInByApi(page, email)
    await page.goto('/profile/')
    await loadTheFixtureLibrary(page)
    await page.goto('/compose/twinkle/')
    await expect(page.getByTestId('song-creator-state')).toBeVisible({ timeout: 60_000 })
    await payToSave(page)
    await uploaded(page)
  })

  await test.step("picks a Handle the first time, from the Toot's row, then the link goes to the share sheet", async () => {
    await page.goto('/toots/')
    const row = page.getByTestId('toot-row')
    await expect(row).toHaveCount(1)
    title = (await row.getByRole('link').locator('span').first().textContent()) ?? ''
    expect(title).toBe(twinkle)
    await row.getByRole('button', { name: `More for ${title}` }).click()
    await shot(page, 'toot-row-menu')
    await page.getByRole('menuitem', { name: 'Share', exact: true }).click()
    await expect(
      page.getByRole('alertdialog').getByRole('heading', { name: 'Pick a handle' })
    ).toBeVisible()
    await shot(page, 'toot-handle')
    await pickAHandle(page, handle, 'Share')

    await expect.poll(shared).toBe(1)
    expect((await shareSheet(page))[0].title).toBe(`${title} by @${handle}`)
    link = await sharedLink(page, 0)
    expect(link).toMatch(linkPattern(handle, 't'))
  })

  await test.step("the Toot's screen says it's shared, and its header's Share offers the same link", async () => {
    await page.getByTestId('toot-row').getByRole('link').click()
    await expect(page).toHaveURL(/\/toots\/toot\/\?id=/)
    tootId = new URL(page.url()).searchParams.get('id') ?? ''
    await expect(page.getByTestId('toot-subtitle')).toHaveText(`${title} · Shared`)
    await shot(page, 'toot-screen-shared')
    await page.getByRole('button', { name: `Share ${title}` }).click()
    await expect(page.getByRole('menuitem', { name: 'Stop sharing' })).toBeVisible()
    await page.getByRole('menuitem', { name: 'Share link' }).click()
    await expect.poll(shared).toBe(2)
    expect(await sharedLink(page, 1)).toBe(link)
  })

  const other = await someoneSignedOut(newContext)
  let imagePath = ''
  const imageOf = (path: string) => imagePath.replace(link, path)

  await test.step('someone signed out opens the link and plays the Toot as it was saved', async () => {
    const response = await other.goto(link)
    expect(response?.status()).toBe(200)
    expectUncached(response?.headers()['cache-control'])
    await expect(other.getByText(`@${handle} shared a Toot`)).toBeVisible()
    await expect(other.getByRole('heading', { name: title })).toBeVisible()
    await expect(other.getByTestId('shared-song')).toHaveText(twinkle)
    await expect(other.getByRole('navigation', { name: 'Tabs' })).toHaveCount(0)
    await shot(other, 'toot-shared-page')
    await expectNothingPrivate(other, response, title, [tootId, email])

    const preview = await expectALinkPreview(other, link, `${title} by @${handle}`)
    imagePath = preview.imagePath
    await expect(meta(other, 'og:description')).toHaveAttribute(
      'content',
      `${twinkle}, played on farts. Tap to play.`
    )
    await testInfo.attach('toot-og-image', { body: preview.image, contentType: 'image/png' })
    if (out) writeFileSync(join(out, 'toot-og-image.png'), preview.image)

    const audio = await other.request.get(`${link}audio/`)
    expect(audio.status()).toBe(200)
    expect(audio.headers()['cache-control']).toBe('private, no-cache')
    const saved = await bytes(page, 'tootAudio', tootId)
    expect(saved && (await audio.body()).equals(saved)).toBe(true)

    await expectItPlays(other, other.getByRole('button', { name: `Play ${title}` }))
    await expect(other.getByRole('button', { name: `Stop ${title}` })).toBeVisible()
    await shot(other, 'toot-shared-playing')
  })

  await test.step('reports it', () => reportIt(other, 'Toot'))

  await test.step('the owner shares a Recording too, and their page lists both, newest first, and plays the Toot (#346)', async () => {
    const tab = await context.newPage()
    await tab.goto('/recordings/')
    await tab
      .getByTestId('recording-row')
      .first()
      .getByRole('button', { name: /^Share / })
      .click()
    await expect.poll(async () => (await shareSheet(tab)).length).toBe(1)
    const recordingLink = await sharedLink(tab, 0)
    expect(recordingLink).toMatch(linkPattern(handle, 'r'))
    await tab.close()

    const response = await other.goto(`/u/${handle}/`)
    expect(response?.status()).toBe(200)
    const rows = other.getByTestId('profile-shared-item')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0).getByRole('link')).toHaveAttribute('href', recordingLink)
    await expect(rows.nth(0).getByRole('link')).toContainText('Recording ·')
    const toot = rows.nth(1).getByRole('link')
    await expect(toot).toHaveAttribute('href', link)
    await expect(toot).toContainText(title)
    await expect(toot).toContainText(`Toot · ${twinkle} · Today`)
    await shot(other, 'toot-profile')
    await expectNothingPrivate(other, response, title, [tootId, email])

    const audio = other.waitForResponse(r => new URL(r.url()).pathname === `${link}audio/`)
    await expectItPlays(other, rows.nth(1).getByRole('button', { name: `Play ${title}` }))
    expect((await audio).status()).toBe(200)
    await expect(rows.nth(1).getByRole('button', { name: `Stop ${title}` })).toBeVisible()
    await shot(other, 'toot-profile-playing')
  })

  await test.step("the owner stops sharing from the Toot's screen, and the link is gone", async () => {
    await page.getByRole('button', { name: `Share ${title}` }).click()
    await page.getByRole('menuitem', { name: 'Stop sharing' }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog.getByRole('heading', { name: `Stop sharing ${title}?` })).toBeVisible()
    await shot(page, 'toot-stop-sharing')
    await dialog.getByRole('button', { name: 'Stop sharing' }).click()
    await expect(page.getByTestId('toot-subtitle')).toHaveText(title)
    await expectGone(other, link, imageOf(link))
    await shot(other, 'toot-link-gone')
    await other.goto(`/u/${handle}/`)
    await expect(other.getByTestId('profile-shared-item')).toHaveCount(1)
    await expect(other.locator(`a[href="${link}"]`)).toHaveCount(0)
  })

  await test.step('shared again, the new link is gone once the Toot is deleted', async () => {
    const before = await shared()
    await page.getByRole('button', { name: `Share ${title}` }).click()
    await expect.poll(shared).toBe(before + 1)
    const again = await sharedLink(page, before)
    expect(again).toMatch(linkPattern(handle, 't'))
    await expectANewLiveLink(other, { link: again, old: link, image: imageOf(again) })

    await page.getByRole('button', { name: `More for ${title}` }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(
      dialog.getByText("Its link stops working too. This can't be undone.")
    ).toBeVisible()
    await dialog.getByRole('button', { name: 'Delete Toot' }).click()
    await expect(page).toHaveURL(/\/toots\/$/)
    await uploaded(page)
    await expectGone(other, again, imageOf(again))
  })
})
