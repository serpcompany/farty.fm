import { onPhone, pagesOutsideTheTabs } from './screens'
import { expect, test } from './test'

test('the privacy page covers accounts, news email, Turnstile, guests, error reports, page views and deleting', async ({
  page
}) => {
  await page.goto('/privacy/')
  await expect(page.getByRole('heading', { name: 'Privacy', level: 1 })).toBeVisible()
  await expect(
    page.getByText('Your email, Recordings and Toots (audio included) are stored on Cloudflare')
  ).toBeVisible()
  await expect(page.getByText('Farty news, which is on by default')).toBeVisible()
  await expect(page.getByText('unsubscribe from any email or on Profile')).toBeVisible()
  await expect(page.getByText('never sold')).toBeVisible()
  await expect(
    page.getByText('Your Recordings and Toots stay in your browser on your device, and only until')
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'The account step' })).toBeVisible()
  await expect(
    page.getByText('When the account step opens, such as after your first Result, Cloudflare')
  ).toBeVisible()
  await expect(page.getByText('Delete account on Profile removes your email')).toBeVisible()
  await expect(page.getByText('it first sends a code to your email')).toBeVisible()
  await expect(page.getByText('when Delete account asks you for a new code')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Error reports', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Page views' })).toBeVisible()
  await expect(page.getByText('counts page views on every page of Farty')).toBeVisible()
  await expect(page.getByText("don't stop it: they stop error reports")).toBeVisible()
  await expect(page.getByText('a sampled summary for 6 months')).toBeVisible()
  await expect(page.getByText('never includes your farts, their names, your email')).toBeVisible()
  await expect(page.getByText('turn off Share anonymous error reports on Profile')).toBeVisible()
  await expect(page.getByText('keeps your IP address, browser and rough location')).toBeVisible()
  await expect(page.getByText('nothing in it follows you to other sites')).toBeVisible()
  await expect(page.getByText("Farty doesn't ask anyone's age")).toBeVisible()
  await expect(page.getByRole('link', { name: 'support@farty.fm' })).toHaveAttribute(
    'href',
    'mailto:support@farty.fm'
  )
})

test('the support page has a way to get in touch', async ({ page }) => {
  await page.goto('/support/')
  await expect(page.getByRole('heading', { name: 'Support', level: 1 })).toBeVisible()
  await expect(page.getByRole('link', { name: 'devin@serp.co' })).toBeVisible()
})

test('a made-up URL answers 404 with one noindex tag and a link home', async ({
  page,
  request,
  pageErrors
}) => {
  pageErrors.expect('the server responded with a status of 404')
  const response = await request.get('/no-such-page/', { maxRedirects: 0 })
  expect(response.status()).toBe(404)

  await page.goto('/no-such-page/')
  await expect(page.getByText('Page not found')).toBeVisible()
  await expect(page.locator('meta[name="robots"]')).toHaveCount(1)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  await expect(page.getByRole('link', { name: 'Back to Farty' })).toHaveAttribute('href', '/')
})

test('Welcome, or from 768px the lander, shows on a first visit but never covers the privacy, support or 404 page', async ({
  page,
  viewport,
  pageErrors
}) => {
  pageErrors.expect('the server responded with a status of 404')
  const welcome = page.getByRole('button', {
    name: onPhone({ viewport }) ? 'Not now' : 'Sign up free'
  })
  await page.goto('/')
  await expect(welcome).toBeVisible()

  for (const [path, content] of pagesOutsideTheTabs(page)) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    await expect(content).toBeVisible()
    await expect(welcome).toHaveCount(0)
  }
})
