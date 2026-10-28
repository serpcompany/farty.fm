import { expect, type Page, test } from '@playwright/test'
import { newEmail, signInByApi } from './account'
import {
  fakeMicrophone,
  fartAndRecord,
  fixtureWavs,
  getUserMediaMs,
  waitForOpenMicrophone
} from './fake-microphone'
import { payAtTheDevCheckout } from './pay'
import { skipWelcome } from './record'

// Saving a Toot on a Production build, where it costs $0.99 as everywhere (ADR 0010, #258): signed
// in, Save to Toots shows the price and goes to the payment step, never a free save; two taps
// start one checkout; and the Toot saves once it's paid, once. Mary Had a Little Lamb unlocks with
// fixtures 095, 017, 022 and 002, as in `compose.spec.ts`.
//
// It runs on the Production build's own Worker, run locally with no `--env`: sign-in has the dev
// mailbox, and with no Stripe key the payment step is the dev checkout (`paymentsConfig`), which
// stands in for Stripe Checkout's page. `pnpm build:production`, then
// `E2E_SERVER=preview E2E_SITE_ENV=production`. CI's e2e builds Staging, where this spec skips and
// `song-creator.spec.ts` and `account.spec.ts` pay the same way.

const production = process.env.E2E_SITE_ENV === 'production'

test.use({ permissions: ['microphone'] })

test.beforeEach(async ({ page }) => {
  test.skip(!production, 'For a Production build (E2E_SITE_ENV=production)')
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

test('a signed-in save pays $0.99 first, and two taps pay for and save one Toot', async ({
  page
}, testInfo) => {
  test.setTimeout(180_000)
  await page.goto('/profile/')
  await signInByApi(page, newEmail(testInfo, 'production-save'))

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

  await tab(page, 'Compose').click()
  await expect(page).toHaveURL(/\/compose\/$/)
  await page.getByTestId('unlocked-songs').getByRole('link').click()
  await expect(page).toHaveURL(/\/compose\/mary\/$/)
  await expect(page.getByTestId('song-creator-state')).toBeVisible({ timeout: 60_000 })

  // Save shows the price. Two taps before the first is answered go to the payment step once.
  const save = page.getByRole('button', { name: 'Save to Toots' })
  await expect(save).toHaveText('Save to Toots · $0.99')
  const writes: string[] = []
  page.on('request', request => {
    const { pathname } = new URL(request.url())
    if (request.method() === 'GET' || !/^\/api\/(toots|dev\/checkout)\//.test(pathname)) return
    writes.push(`${request.method()} ${pathname.replace(/[0-9a-f-]{36}/, '{id}')}`)
  })
  await save.evaluate(button => {
    ;(button as HTMLButtonElement).click()
    ;(button as HTMLButtonElement).click()
  })
  await payAtTheDevCheckout(page)
  await expect(page.getByText("Couldn't save this Toot.")).toHaveCount(0)

  // The account has it, once, and the Toot went up only after it was paid for.
  await expect.poll(() => accountToots(page), { timeout: 30_000 }).toHaveLength(1)
  await page.waitForTimeout(1000)
  expect(await accountToots(page)).toHaveLength(1)
  expect(writes).toEqual([
    'POST /api/toots/{id}/checkout/',
    'POST /api/dev/checkout/',
    'PUT /api/toots/{id}/'
  ])

  // Back to Compose, and Toots has the one Toot.
  await page.getByRole('link', { name: 'Back to Compose' }).click()
  await expect(page).toHaveURL(/\/compose\/$/)
  await expect(page.getByRole('heading', { name: 'Unlocked · 1' })).toBeVisible()
  await tab(page, 'Toots').click()
  await expect(page.getByText('Mary Had a Little Lamb')).toHaveCount(1)
})
