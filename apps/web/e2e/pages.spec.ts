import { expect, test } from '@playwright/test'

test('the privacy page covers accounts, news email, guests, error reports, usage and deleting', async ({
  page
}) => {
  await page.goto('/privacy/')
  await expect(page.getByRole('heading', { name: 'Privacy', level: 1 })).toBeVisible()
  await expect(
    page.getByText('Your email, Recordings and Toots (audio included) are stored on Cloudflare')
  ).toBeVisible()
  await expect(page.getByText('Pedos news, which is on by default')).toBeVisible()
  await expect(page.getByText('unsubscribe from any email or on Profile')).toBeVisible()
  await expect(page.getByText('never sold')).toBeVisible()
  await expect(page.getByText('last only until you close Pedos')).toBeVisible()
  await expect(page.getByText('Delete account on Profile removes your email')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Error reports and usage' })).toBeVisible()
  await expect(page.getByText('never includes your farts, their names, your email')).toBeVisible()
  await expect(page.getByText('turn off Share anonymous error reports and usage')).toBeVisible()
  await expect(page.getByText('keeps your IP address, browser and rough location')).toBeVisible()
  await expect(page.getByText('nothing in it follows you to other sites')).toBeVisible()
  await expect(page.getByText("Pedos doesn't ask anyone's age")).toBeVisible()
  await expect(page.getByRole('link', { name: 'support@pedos.app' })).toHaveAttribute(
    'href',
    'mailto:support@pedos.app'
  )
})

test('the support page has a way to get in touch', async ({ page }) => {
  await page.goto('/support/')
  await expect(page.getByRole('heading', { name: 'Support', level: 1 })).toBeVisible()
  await expect(page.getByRole('link', { name: 'devin@serp.co' })).toBeVisible()
})

test('a made-up URL answers 404 with one noindex tag and a link home', async ({
  page,
  request
}) => {
  const response = await request.get('/no-such-page/', { maxRedirects: 0 })
  expect(response.status()).toBe(404)

  await page.goto('/no-such-page/')
  await expect(page.getByText('Page not found')).toBeVisible()
  await expect(page.locator('meta[name="robots"]')).toHaveCount(1)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  await expect(page.getByRole('link', { name: 'Back to Pedos' })).toHaveAttribute('href', '/')
})

test('Welcome shows on the tabs but never covers the privacy, support or 404 page', async ({
  page
}) => {
  const welcome = page.getByRole('button', { name: 'Not now' })
  await page.goto('/')
  await expect(welcome).toBeVisible()

  for (const [path, content] of [
    ['/privacy/', page.getByRole('heading', { name: 'Privacy', level: 1 })],
    ['/support/', page.getByRole('heading', { name: 'Support', level: 1 })],
    ['/nope/', page.getByText('Page not found')]
  ] as const) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    await expect(content).toBeVisible()
    await expect(welcome).toHaveCount(0)
  }
})
