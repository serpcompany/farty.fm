import { randomInt } from 'node:crypto'
import { expect, type Page, test } from '@playwright/test'
import { newEmail, signInByApi } from './account'
import { skipWelcome } from './record'

// Friends and profile pages (#319, ADR 0021): one user opens another's page and sends a friend
// request, picking a Handle first; the other accepts it in Profile, and then removes them.

// A service worker would answer navigations itself, without the Staging gate's credentials.
test.use({ serviceWorkers: 'block' })

/** Claims `handle` for the signed-in account, as the first share does. */
async function claimHandle(page: Page, handle: string) {
  const status = await page.evaluate(
    async handle =>
      (
        await fetch('/api/handle/', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ handle })
        })
      ).status,
    handle
  )
  expect(status).toBe(201)
}

test('a friend request sent from a profile page is accepted in Profile, then removed', async ({
  page,
  browser,
  baseURL,
  httpCredentials,
  viewport,
  userAgent,
  deviceScaleFactor,
  isMobile,
  hasTouch
}, testInfo) => {
  test.setTimeout(120_000)
  const maya = `e2e_${randomInt(1e9)}`
  const sam = `e2e_${randomInt(1e9)}`

  await test.step('maya has an account and a Handle', async () => {
    await page.addInitScript(skipWelcome, {})
    await page.goto('/profile/')
    await signInByApi(page, newEmail(testInfo, 'maya'))
    await claimHandle(page, maya)
  })

  const other = await browser.newContext({
    baseURL,
    httpCredentials,
    viewport,
    userAgent,
    deviceScaleFactor,
    isMobile,
    hasTouch,
    serviceWorkers: 'block'
  })
  const samPage = await other.newPage()

  await test.step("signed out, maya's page has Add friend and nothing shared", async () => {
    const response = await samPage.goto(`/u/${maya}/`)
    expect(response?.status()).toBe(200)
    const cache = response?.headers()['cache-control'] ?? ''
    expect(cache).toContain('private')
    expect(cache).toContain('no-cache')
    await expect(samPage.getByRole('heading', { name: `@${maya}` })).toBeVisible()
    await expect(samPage.getByText('Nothing shared yet.')).toBeVisible()
    // Signed out, it's Get Farty's way in (#318): get-farty.spec.ts follows it.
    await expect(samPage.getByRole('button', { name: 'Add friend' })).toBeVisible()
    await expect(samPage.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  })

  await test.step('sam signs in, picks a Handle and sends a request from the page', async () => {
    await signInByApi(samPage, newEmail(testInfo, 'sam'))
    await samPage.reload()
    await samPage.getByRole('button', { name: 'Add friend' }).click()
    const dialog = samPage.getByRole('alertdialog')
    await expect(dialog.getByRole('heading', { name: 'Pick a handle' })).toBeVisible()
    await dialog.getByRole('textbox', { name: 'Handle' }).fill(sam)
    await expect(dialog.getByText(`@${sam} is free`)).toBeVisible()
    await dialog.getByRole('button', { name: 'Add friend' }).click()
    await expect(dialog).toBeHidden()
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

  await other.close()
})
