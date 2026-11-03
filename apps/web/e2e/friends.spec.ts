import { newEmail, signInByApi } from './account'
import {
  expectUncached,
  friendRequestBeforeAHandle,
  newHandle,
  pickAHandle,
  signedInWithAHandle
} from './sharing'
import { expect, test } from './test'

test.use({ serviceWorkers: 'block' })

test('a friend request sent from a profile page is accepted in Profile, then removed', async ({
  page,
  newContext,
  pageErrors
}, testInfo) => {
  test.setTimeout(120_000)
  pageErrors.expect(friendRequestBeforeAHandle)
  const maya = newHandle()
  const sam = newHandle()

  await test.step('maya has an account and a Handle', () =>
    signedInWithAHandle(page, newEmail(testInfo, 'maya'), maya))

  const samPage = await (await newContext()).newPage()

  await test.step("signed out, maya's page has Add friend and nothing shared", async () => {
    const response = await samPage.goto(`/u/${maya}/`)
    expect(response?.status()).toBe(200)
    expectUncached(response?.headers()['cache-control'])
    await expect(samPage.getByRole('heading', { name: `@${maya}` })).toBeVisible()
    await expect(samPage.getByText('Nothing shared yet.')).toBeVisible()
    await expect(samPage.getByRole('button', { name: 'Add friend' })).toBeVisible()
    await expect(samPage.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  })

  await test.step('sam signs in, picks a Handle and sends a request from the page', async () => {
    await signInByApi(samPage, newEmail(testInfo, 'sam'))
    await samPage.reload()
    await samPage.getByRole('button', { name: 'Add friend' }).click()
    await pickAHandle(samPage, sam, 'Add friend')
    await expect(samPage.getByRole('button', { name: 'Requested' })).toBeVisible()
  })

  await test.step('maya accepts it in Profile', async () => {
    await page.reload()
    const request = page.getByTestId('friend-request')
    await expect(request).toHaveText(new RegExp(`@${sam}`))
    await page.getByRole('button', { name: `Accept @${sam}` }).click()
    await expect(page.getByTestId('friend')).toHaveText(`@${sam}`)
    await expect(page.getByRole('heading', { name: 'Friend requests' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Your page' })).toHaveAttribute(
      'href',
      `/u/${maya}/`
    )

    await samPage.reload()
    await expect(samPage.getByRole('button', { name: 'Friends' })).toBeVisible()
  })

  await test.step('maya removes sam, after asking', async () => {
    await page.getByRole('button', { name: `More for @${sam}` }).click()
    await page.getByRole('menuitem', { name: 'Remove friend' }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog.getByRole('heading', { name: `Remove @${sam}?` })).toBeVisible()
    await dialog.getByRole('button', { name: 'Remove' }).click()
    await expect(page.getByTestId('friend')).toHaveCount(0)
    await expect(
      page.getByText('No friends yet. Add one by their handle, or from their page.')
    ).toBeVisible()

    await samPage.reload()
    await expect(samPage.getByRole('button', { name: 'Add friend' })).toBeVisible()
  })
})
