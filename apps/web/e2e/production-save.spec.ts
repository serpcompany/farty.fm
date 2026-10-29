import type { Page } from '@playwright/test'
import { newEmail, signInByApi } from './account'
import { uploaded } from './database'
import { payAtTheDevCheckout } from './pay'
import { fartAndSave, withFartingMicrophone } from './record'
import { tab } from './screens'
import { openASong } from './songs'
import { expect, test } from './test'

withFartingMicrophone()
test.skip(
  process.env.E2E_SITE_ENV !== 'production',
  'For a Production build (E2E_SITE_ENV=production)'
)

function accountToots(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const library = (await (await fetch('/api/library/')).json()) as { toots: { id: string }[] }
    return library.toots.map(toot => toot.id)
  })
}

function watchWrites(page: Page): string[] {
  const writes: string[] = []
  page.on('request', request => {
    const { pathname } = new URL(request.url())
    if (request.method() === 'GET' || !/^\/api\/(toots|dev\/checkout)\//.test(pathname)) return
    writes.push(`${request.method()} ${pathname.replace(/[0-9a-f-]{36}/, '{id}')}`)
  })
  return writes
}

test('a signed-in save pays $0.99 first, and two taps pay for and save one Toot', async ({
  page
}, testInfo) => {
  test.setTimeout(180_000)
  await page.goto('/profile/')
  await signInByApi(page, newEmail(testInfo, 'production-save'))

  await page.goto('/')
  for (const id of ['095', '017', '022']) {
    await fartAndSave(page, id)
    await page.getByRole('button', { name: 'Record another' }).click()
  }
  await fartAndSave(page, '002')
  await expect(page.getByTestId('result-progress')).toContainText(
    'You unlocked Mary Had a Little Lamb'
  )
  await page.getByRole('button', { name: 'Done' }).click()
  await openASong(page, 'mary')

  const save = page.getByRole('button', { name: 'Save to Toots' })
  await expect(save).toHaveText('Save to Toots · $0.99')
  const writes = watchWrites(page)
  await save.evaluate(button => {
    ;(button as HTMLButtonElement).click()
    ;(button as HTMLButtonElement).click()
  })
  await payAtTheDevCheckout(page)
  await expect(page.getByText("Couldn't save this Toot.")).toHaveCount(0)

  await expect.poll(() => accountToots(page), { timeout: 30_000 }).toHaveLength(1)
  await uploaded(page)
  expect(await accountToots(page)).toHaveLength(1)
  expect(writes).toEqual([
    'POST /api/toots/{id}/checkout/',
    'POST /api/dev/checkout/',
    'PUT /api/toots/{id}/'
  ])

  await page.getByRole('link', { name: 'Back to Compose' }).click()
  await expect(page).toHaveURL(/\/compose\/$/)
  await expect(page.getByRole('heading', { name: 'Unlocked · 1' })).toBeVisible()
  await tab(page, 'Toots').click()
  await expect(page).toHaveURL(/\/toots\/$/)
  const toots = page.getByTestId('toot-row')
  await expect(toots).toHaveCount(1)
  await expect(toots).toContainText('Mary Had a Little Lamb')
})
