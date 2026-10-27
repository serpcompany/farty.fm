import { expect, type Page, test } from '@playwright/test'
import { newEmail, signInByApi } from './account'
import {
  fakeMicrophone,
  fartAndRecord,
  fixtureWavs,
  getUserMediaMs,
  waitForOpenMicrophone
} from './fake-microphone'
import { skipWelcome } from './record'

// Saving a Toot on Production, where it's free (ADR 0010, #213): signed in, Save to Toots saves at
// once with no price and no checkout, two taps save one Toot, and the system Back leaves Song
// Creator for Compose. Mary Had a Little Lamb unlocks with fixtures 095, 017, 022 and 002, as in
// `compose.spec.ts`.
//
// It runs on the Production build's own Worker, run locally with no `--env`, so sign-in has the dev
// mailbox: `pnpm build:production`, then `E2E_SERVER=preview E2E_SITE_ENV=production`.

const production = process.env.E2E_SITE_ENV === 'production'

test.use({ permissions: ['microphone'] })

test.beforeEach(async ({ page }) => {
  test.skip(!production, 'Saving is free only in a Production build (E2E_SITE_ENV=production)')
  await page.addInitScript(fakeMicrophone, { wavs: fixtureWavs(), delayMs: getUserMediaMs })
  await page.addInitScript(skipWelcome)
})

function tab(page: Page, label: string) {
  return page
    .getByRole('navigation', { name: 'Tabs' })
    .getByRole('link', { name: label, exact: true })
}

/** The account's Toots, as the server has them. */
async function accountToots(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const library = (await (await fetch('/api/library/')).json()) as { toots: { id: string }[] }
    return library.toots.map(toot => toot.id)
  })
}

test('a signed-in save is free, saves one Toot for two taps, and Back leaves Song Creator', async ({
  page
}, testInfo) => {
  test.setTimeout(180_000)
  await page.goto('/profile/')
  await signInByApi(page, newEmail(testInfo, 'free-save'))

  // Four takes unlock Mary.
  await page.goto('/')
  for (const id of ['095', '017', '022', '002']) {
    await waitForOpenMicrophone(page)
    await fartAndRecord(page, id)
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('result-note')).toBeVisible()
    if (id !== '002') await page.getByRole('button', { name: 'Record another' }).click()
  }
  await expect(page.getByTestId('result-progress')).toContainText(
    'You unlocked Mary Had a Little Lamb'
  )
  await page.getByRole('button', { name: 'Done' }).click()

  // Compose, then Song Creator, so the system Back has Compose to go back to.
  await tab(page, 'Compose').click()
  await expect(page).toHaveURL(/\/compose\/$/)
  await page.getByTestId('unlocked-songs').getByRole('link').click()
  await expect(page).toHaveURL(/\/compose\/mary\/$/)
  await expect(page.getByTestId('song-creator-state')).toBeVisible({ timeout: 60_000 })

  // No price, and no checkout: two taps before the first is answered save one Toot.
  const save = page.getByRole('button', { name: 'Save to Toots' })
  await expect(save).toHaveText('Save to Toots')
  const requests: string[] = []
  page.on('request', request => requests.push(new URL(request.url()).pathname))
  await save.evaluate(button => {
    ;(button as HTMLButtonElement).click()
    ;(button as HTMLButtonElement).click()
  })
  await expect(page.getByRole('button', { name: 'Saved to Toots' })).toBeDisabled()
  await expect(page.getByText("Couldn't save this Toot.")).toHaveCount(0)
  await expect(page).toHaveURL(/\/compose\/mary\/$/)
  expect(requests.filter(path => path.includes('/checkout/'))).toEqual([])

  // The account has it, once.
  await expect.poll(() => accountToots(page), { timeout: 30_000 }).toHaveLength(1)
  await page.waitForTimeout(1000)
  expect(await accountToots(page)).toHaveLength(1)

  // The system Back leaves Song Creator for Compose, and Toots has the one Toot.
  await page.goBack()
  await expect(page).toHaveURL(/\/compose\/$/)
  await expect(page.getByRole('heading', { name: 'Unlocked · 1' })).toBeVisible()
  await tab(page, 'Toots').click()
  await expect(page.getByText('Mary Had a Little Lamb')).toHaveCount(1)
})
