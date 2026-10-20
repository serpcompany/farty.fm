import { expect, test } from '@playwright/test'

test('the privacy page says there is no tracking', async ({ page }) => {
  await page.goto('/privacy/')
  await expect(page.getByRole('heading', { name: 'Privacy', level: 1 })).toBeVisible()
  await expect(page.getByText('no ads, analytics or tracking')).toBeVisible()
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
