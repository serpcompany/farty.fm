import { newEmail, ownClient, signInByApi, signUpInTheStep } from './account'
import { uploaded } from './database'
import {
  deleteRecording,
  fartAndRecord,
  recordAndSave,
  recordG3,
  waitForOpenMicrophone,
  withFartingMicrophone
} from './record'
import { onPhone } from './screens'
import {
  expectALinkPreview,
  expectANewLiveLink,
  expectGone,
  expectItPlays,
  expectUncached,
  fakeShareSheet,
  linkPattern,
  newHandle,
  pickAHandle,
  reportIt,
  sharedLink,
  shareSheet,
  someoneSignedOut
} from './sharing'
import { expect, test } from './test'

withFartingMicrophone()
test.use({ serviceWorkers: 'block' })

test('a signed-in user shares a Recording, someone signed out plays it, and Stop sharing takes the link down', async ({
  context,
  newContext,
  pageErrors
}, testInfo) => {
  test.setTimeout(180_000)
  pageErrors.expect('the server responded with a status of 404')
  const handle = newHandle()
  await fakeShareSheet(context)
  const page = await context.newPage()
  let link = ''

  await test.step('signs in and records a G3', async () => {
    await page.goto('/profile/')
    await signInByApi(page, newEmail(testInfo, 'share'))
    await recordG3(page)
    await page.getByRole('button', { name: 'Done' }).click()
    await uploaded(page)
  })

  await test.step('picks a Handle the first time, then the link goes to the share sheet', async () => {
    await page.goto('/recordings/')
    await page.getByRole('button', { name: 'Share Recording 1' }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog.getByRole('heading', { name: 'Pick a handle' })).toBeVisible()
    await dialog.getByRole('textbox', { name: 'Handle' }).fill('farty')
    await expect(dialog.getByText("@farty isn't allowed. Try another.")).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Share' })).toBeDisabled()
    await pickAHandle(page, handle, 'Share')

    await expect.poll(async () => (await shareSheet(page)).length).toBe(1)
    expect((await shareSheet(page))[0].title).toBe(`Recording 1 by @${handle}`)
    link = await sharedLink(page, 0)
    expect(link).toMatch(linkPattern(handle, 'r'))
    await expect(page.getByTestId('recording-shared')).toHaveText('Shared')
  })

  await test.step('Profile shows the Handle', async () => {
    await page.goto('/profile/')
    await expect(page.getByTestId('account-handle')).toHaveText(`@${handle}`)
  })

  const other = await someoneSignedOut(newContext)
  let imagePath = ''
  const imageOf = (path: string) => imagePath.replace(link, path)
  const gone = (path: string) => expectGone(other, path, imageOf(path))

  await test.step('someone signed out opens the link and plays it', async () => {
    const response = await other.goto(link)
    expect(response?.status()).toBe(200)
    expectUncached(response?.headers()['cache-control'])
    await expect(other.getByText(`@${handle} shared a Recording`)).toBeVisible()
    await expect(other.getByRole('heading', { name: 'Recording 1' })).toBeVisible()
    await expect(other.getByTestId('shared-note')).toHaveText('G3')
    await expect(other.getByRole('button', { name: 'Get Farty' }).first()).toBeVisible()
    await expect(other.getByRole('link', { name: 'Get Farty' })).toHaveCount(0)
    await expect(other.getByRole('navigation', { name: 'Tabs' })).toHaveCount(0)

    const preview = await expectALinkPreview(other, link, `Recording 1 by @${handle}`)
    imagePath = preview.imagePath
    await testInfo.attach('og-image', { body: preview.image, contentType: 'image/png' })

    await expectItPlays(other, other.getByRole('button', { name: 'Play Recording 1' }))
  })

  await test.step('reports it', () => reportIt(other, 'Recording'))

  await test.step('the owner stops sharing, and the link is gone', async () => {
    await page.goto('/recordings/')
    await expect(page.getByTestId('recording-shared')).toBeVisible()
    await page.getByRole('button', { name: 'Share Recording 1' }).click()
    await page.getByRole('menuitem', { name: 'Stop sharing' }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog.getByRole('heading', { name: 'Stop sharing Recording 1?' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Stop sharing' }).click()
    await expect(page.getByTestId('recording-shared')).toHaveCount(0)
    await gone(link)
  })

  await test.step('a link nobody shared is gone too', async () => {
    await gone(`/u/${handle}/r/000000000000/`)
  })

  await test.step('shared again, the new link is gone once the Recording is deleted', async () => {
    await page.getByRole('button', { name: 'Share Recording 1' }).click()
    await expect.poll(async () => (await shareSheet(page)).length).toBe(1)
    const again = await sharedLink(page, 0)
    expect(again).toMatch(linkPattern(handle, 'r'))
    await expectANewLiveLink(other, { link: again, old: link, image: imageOf(again) })

    await deleteRecording(page, 1)
    await uploaded(page)
    await gone(again)
  })
})

test("a guest records, reviews and saves, then shares from Result once they've made an account, and someone signed out plays it (#320)", async ({
  context,
  newContext,
  viewport
}, testInfo) => {
  test.skip(!onPhone({ viewport }), 'Share from Result is checked at phone size')
  test.setTimeout(180_000)
  const handle = newHandle()
  await ownClient(context)
  await fakeShareSheet(context)
  const page = await context.newPage()

  await test.step('records a G3, names it on its review, and saves it', async () => {
    await page.goto('/')
    await waitForOpenMicrophone(page)
    await fartAndRecord(page)
    await expect(page.getByRole('button', { name: /^Share/ })).toHaveCount(0)
    await page.getByRole('textbox', { name: 'Name' }).fill('Morning toot')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('result-note')).toHaveText('G3')
  })

  await test.step("Result's Share asks for a free account, then a Handle, then shares", async () => {
    await page.getByRole('button', { name: 'Share Morning toot' }).click()
    const step = page.getByRole('dialog', { name: 'Make a free account' })
    await expect(step.getByText('You need one to share. It keeps your farts too.')).toBeVisible()
    await signUpInTheStep(page, newEmail(testInfo, 'share-result'))

    await pickAHandle(page, handle, 'Share')
    await expect.poll(async () => (await shareSheet(page)).length).toBe(1)
    expect((await shareSheet(page))[0].title).toBe(`Morning toot by @${handle}`)
    expect(await sharedLink(page, 0)).toMatch(linkPattern(handle, 'r'))
    await expect(page.getByTestId('result-note')).toHaveText('G3')
  })

  await test.step('someone signed out opens the link and plays it', async () => {
    const other = await someoneSignedOut(newContext)
    expect((await other.goto(await sharedLink(page, 0)))?.status()).toBe(200)
    await expect(other.getByText(`@${handle} shared a Recording`)).toBeVisible()
    await expect(other.getByRole('heading', { name: 'Morning toot' })).toBeVisible()
    await expect(other.getByTestId('shared-note')).toHaveText('G3')
    await expectItPlays(other, other.getByRole('button', { name: 'Play Morning toot' }), {
      longerThanSeconds: 0.2
    })
  })
})

test('a guest who taps Share is asked to make a free account first', async ({ context }) => {
  await fakeShareSheet(context)
  const page = await context.newPage()
  await recordAndSave(page)
  await page.getByRole('button', { name: 'Done' }).click()
  await page.goto('/recordings/')
  await page.getByRole('button', { name: 'Share Recording 1' }).click()
  await expect(page.getByRole('heading', { name: 'Make a free account' })).toBeVisible()
  await expect(page.getByText('You need one to share. It keeps your farts too.')).toBeVisible()
  await page.getByRole('button', { name: 'Not now' }).click()
  await expect(page.getByRole('heading', { name: 'Make a free account' })).toBeHidden()
  expect(await shareSheet(page)).toHaveLength(0)
})
