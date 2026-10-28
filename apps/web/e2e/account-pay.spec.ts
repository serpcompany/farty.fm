import type { Page } from '@playwright/test'
import { accountOf, codeFor, newEmail, ownClient, signInByApi } from './account'
import { stored, uploaded } from './database'
import { payAtTheDevCheckout } from './pay'
import { skipWelcome } from './record'
import { expectTappable, onPhone, tab } from './screens'
import { loadTheFixtureLibrary, needsTheFixtureLibrary, openASong } from './songs'
import { expect, test } from './test'

test.skip(({ viewport }) => !onPhone({ viewport }), 'The account step is checked at phone size')
needsTheFixtureLibrary()
test.describe.configure({ timeout: 180_000 })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(skipWelcome)
})

async function playMaryFree(page: Page) {
  await loadTheFixtureLibrary(page)
  await openASong(page, 'mary')
  await expect(page.getByTestId('song-creator-state')).toHaveText('Playing')
}

async function checkoutToot(page: Page): Promise<string> {
  await expect(page).toHaveURL(/\/dev\/checkout\/\?toot=[\w-]+&song=\w+$/, { timeout: 30_000 })
  return new URL(page.url()).searchParams.get('toot') as string
}

test("a guest's Toot plays free, and Save asks for an account first", async ({ page }) => {
  await page.goto('/profile/')
  await playMaryFree(page)

  const save = page.getByRole('button', { name: 'Save to Toots' })
  await expect(save).toHaveText('Save to Toots · $0.99')
  await expectTappable(save)
  await save.click()
  const step = page.getByRole('dialog', { name: 'Keep your farts' })
  await expect(step).toBeVisible()
  await step.getByRole('button', { name: 'Not now' }).click()
  await expect(step).toBeHidden()

  await expect(page).toHaveURL(/\/compose\/mary\/$/)
  await expect(save).toBeEnabled()
  expect(await stored(page, 'toots')).toBe(0)
  await save.click()
  await expect(step).toBeVisible()
  await step.getByRole('button', { name: 'Not now' }).click()
  await tab(page, 'Toots').click()
  await expect(page.getByText('Nothing yet')).toBeVisible()

  await tab(page, 'Profile').click()
  await page.getByRole('button', { name: 'Save to an account' }).click()
  await expect(step).toBeVisible()
})

test('a guest who signs in at Save pays $0.99, and the Toot is saved to the account', async ({
  page
}, testInfo) => {
  const email = newEmail(testInfo, 'pay')
  await ownClient(page.context())
  await page.goto('/profile/')
  await playMaryFree(page)

  await page.getByRole('button', { name: 'Save to Toots · $0.99' }).click()
  const step = page.getByRole('dialog', { name: 'Keep your farts' })
  await step.getByLabel('Email').fill(email)
  await step.getByRole('button', { name: 'Send code' }).click()
  await step.getByLabel('Code').fill(await codeFor(page, email))
  await step.getByRole('button', { name: 'Sign in' }).click()
  await expect(step).toBeHidden()

  const checkout = await checkoutToot(page)
  await expectTappable(page.getByRole('button', { name: 'Pay $0.99' }))
  await payAtTheDevCheckout(page)
  expect(await stored(page, 'toots')).toBe(1)
  await uploaded(page)
  const kept = await page.evaluate(
    async account =>
      (await (
        await fetch('/api/library/', { headers: { 'x-pedos-library': account ?? '' } })
      ).json()) as { toots: { id: string }[] },
    await accountOf(page)
  )
  expect(kept.toots.map(toot => toot.id)).toEqual([checkout])

  await tab(page, 'Toots').click()
  await expect(page.getByTestId('toot-row')).toHaveCount(1)
  await expect(page.getByTestId('toot-row')).toContainText('Mary Had a Little Lamb')
})

test('cancelled at the checkout, the Toot is still unsaved, and Save pays for that same Toot', async ({
  page
}, testInfo) => {
  await page.goto('/profile/')
  await signInByApi(page, newEmail(testInfo, 'cancel'))
  await page.reload()
  await playMaryFree(page)

  const save = page.getByRole('button', { name: 'Save to Toots · $0.99' })
  await save.click()
  const toot = await checkoutToot(page)
  await page.getByRole('link', { name: 'Cancel' }).click()
  await expect(page).toHaveURL(/\/compose\/mary\/$/)
  await expect(page.getByTestId('song-creator-state')).toBeVisible({ timeout: 60_000 })
  await expect(save).toBeEnabled()
  expect(await stored(page, 'toots')).toBe(0)

  await save.click()
  expect(await checkoutToot(page)).toBe(toot)
  await payAtTheDevCheckout(page)
  expect(await stored(page, 'toots')).toBe(1)
})
