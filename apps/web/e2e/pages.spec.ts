import { expect, test } from '@playwright/test'
import { onPhone } from './screens'

test('the privacy page covers accounts, news email, Turnstile, guests, error reports, page views, fart places and deleting', async ({
  page
}) => {
  await page.goto('/privacy/')
  await expect(page.getByRole('heading', { name: 'Privacy', level: 1 })).toBeVisible()
  await expect(
    page.getByText(
      'Your email, Recordings and Toots (audio included), and the city each Recording was first uploaded from, are stored on Cloudflare'
    )
  ).toBeVisible()
  await expect(page.getByText('the city you recorded it in')).toBeVisible()
  await expect(page.getByText("It doesn't ask your phone for its location")).toBeVisible()
  await expect(page.getByText("so a VPN shows the VPN's city")).toBeVisible()
  await expect(
    page.getByText('Turning off Show where I farted on Profile deletes every place Farty kept')
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
  await expect(page.getByRole('heading', { name: 'Error reports', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Page views' })).toBeVisible()
  await expect(page.getByText('counts page views on every page of Farty')).toBeVisible()
  await expect(page.getByText("don't stop it: they stop error reports")).toBeVisible()
  await expect(page.getByText('a sampled summary for 6 months')).toBeVisible()
  await expect(page.getByText('never includes your farts, their names, your email')).toBeVisible()
  await expect(
    page.getByText('turn off Share anonymous usage and error reports on Profile')
  ).toBeVisible()
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
  request
}) => {
  const response = await request.get('/no-such-page/', { maxRedirects: 0 })
  expect(response.status()).toBe(404)

  await page.goto('/no-such-page/')
  await expect(page.getByText('Page not found')).toBeVisible()
  await expect(page.locator('meta[name="robots"]')).toHaveCount(1)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  await expect(page.getByRole('link', { name: 'Back to Farty' })).toHaveAttribute('href', '/')
})

test('an old /u/ link answers one 308 to its /@ path, query kept, and a path with no @ is no page (#382)', async ({
  page,
  request
}) => {
  const location = async (path: string) => {
    const response = await request.get(path, { maxRedirects: 0 })
    expect(response.status(), path).toBe(308)
    const to = new URL(response.headers().location ?? '', 'http://farty.test')
    return decodeURIComponent(to.pathname) + to.search
  }
  for (const [from, to] of [
    ['/u/nobody/', '/@nobody/'],
    ['/u/nobody/report/', '/@nobody/report/'],
    ['/u/nobody/r/AAAAAAAAAAAA/?from=messages', '/@nobody/r/AAAAAAAAAAAA/?from=messages'],
    ['/u/nobody/t/AAAAAAAAAAAA/', '/@nobody/t/AAAAAAAAAAAA/'],
    ['/u/nobody/t/AAAAAAAAAAAA/audio/', '/@nobody/t/AAAAAAAAAAAA/audio/'],
    // A shared page's old link image is its `image/` now. Next writes a query key with no value
    // back with an `=`, which the image ignores, as it ignored the old one's.
    ['/u/nobody/r/AAAAAAAAAAAA/opengraph-image/?a1b2', '/@nobody/r/AAAAAAAAAAAA/image/?a1b2=']
  ]) {
    expect(await location(from), from).toBe(to)
  }
  // The old link image's own URL had no trailing slash: Next adds it first.
  const image = await request.get('/u/nobody/t/AAAAAAAAAAAA/opengraph-image?a1b2')
  expect(new URL(image.url()).pathname + new URL(image.url()).search).toBe(
    '/@nobody/t/AAAAAAAAAAAA/image/?a1b2='
  )
  expect(image.status()).toBe(404)

  // A Handle no one has is the shared page's 404; a path with no `@` is the site's.
  for (const path of ['/@nobody/', '/@nobody/r/AAAAAAAAAAAA/', '/%40nobody/t/AAAAAAAAAAAA/']) {
    expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(404)
  }
  for (const path of ['/nobody/', '/nobody/r/AAAAAAAAAAAA/', '/u/']) {
    expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(404)
    await page.goto(path)
    await expect(page.getByText('Page not found'), path).toBeVisible()
    await expect(page.locator('meta[name="robots"]')).toHaveCount(1)
  }
})

test('Welcome, or from 768px the lander, shows on a first visit but never covers the privacy, support or 404 page', async ({
  page,
  viewport
}) => {
  const welcome = page.getByRole('button', {
    name: onPhone({ viewport }) ? 'Not now' : 'Sign up free'
  })
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
