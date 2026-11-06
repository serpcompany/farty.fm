import { type APIRequestContext, expect, type Locator, type Page, test } from '@playwright/test'
import { codeFor, newEmail, ownClient, signInByApi } from './account'
import {
  fakeMicrophone,
  fartAndRecord,
  fixtureWavs,
  getUserMediaMs,
  waitForOpenMicrophone
} from './fake-microphone'
import { skipWelcome } from './record'

// The two offers of Full Access before Save (#407, ADR 0022): a button on Welcome, and the first
// Result. Each journey watches every frame for a sheet stacked on the account step. A local run has no
// Stripe key, so Pay goes to the dev checkout, which stands in for Stripe Checkout.

test.use({ permissions: ['microphone'], serviceWorkers: 'block' })

/** What the frames showed in this test, across pages. */
let seen: { stacked: boolean; sheet: boolean }

test.beforeEach(async ({ page }, testInfo) => {
  seen = { stacked: false, sheet: false }
  test.skip(testInfo.project.name !== 'phone', 'Welcome, the first offer, is phone-only')
  await page.exposeFunction('sawOnScreen', (what: 'stacked' | 'sheet') => {
    seen[what] = true
  })
  await page.addInitScript(() => {
    const report = (window as unknown as { sawOnScreen: (what: string) => void }).sawOnScreen
    const look = () => {
      const sheet = document.querySelector('[data-testid="full-access-sheet"]')
      const step = document.querySelector('[aria-labelledby="account-step-title"]')
      if (sheet) report('sheet')
      if (sheet && step) report('stacked')
      requestAnimationFrame(look)
    }
    requestAnimationFrame(look)
  })
  await page.addInitScript(fakeMicrophone, { wavs: fixtureWavs(), delayMs: getUserMediaMs })
  await ownClient(page.context())
})

test.afterEach(() => {
  expect(seen.stacked, 'the sheet opened over the account step').toBe(false)
})

const allow = (page: Page) => page.getByRole('button', { name: 'Allow microphone' })
const welcomeOffer = (page: Page) => page.getByRole('button', { name: 'Get Full Access for $4.99' })
const sheet = (page: Page) => page.getByTestId('full-access-sheet')
const accountStep = (page: Page) => page.locator('[aria-labelledby="account-step-title"]')
const PAID = 'Payment confirmed. You have Full Access.'

/** Every offer step this page sends, from now on. */
function offerStepsFrom(page: Page): string[] {
  const sent: string[] = []
  page.on('request', request => {
    if (new URL(request.url()).pathname !== '/api/steps/') return
    const { step, ...rest } = request.postDataJSON() as { step: string }
    expect(rest).toEqual({})
    if (step.startsWith('offer-')) sent.push(step)
  })
  return sent
}

/** Waits long enough for a step the page would send to have gone. */
const aMoment = (page: Page) => page.waitForTimeout(500)

/** The account step is open: makes the account. */
async function signUpOnTheStep(page: Page, email: string) {
  const step = accountStep(page)
  await step.getByLabel('Email').fill(email)
  await step.getByRole('button', { name: 'Send code' }).click()
  await step.getByLabel('Code').fill(await codeFor(page, email))
  await step.getByRole('button', { name: 'Sign in' }).click()
  await expect(step).toBeHidden()
}

/** The sheet is open: its Pay, then the dev checkout's, coming back to `back`. */
async function payOnTheOffer(page: Page, back: string) {
  await sheet(page).getByRole('button', { name: 'Pay $4.99' }).click()
  await expect(page).toHaveURL(
    new RegExp(`/dev/checkout/\\?return=page&path=${encodeURIComponent(back)}$`)
  )
  await page.getByRole('button', { name: 'Pay $4.99' }).click()
}

/** The account has Full Access, paid with the page's own requests. */
async function buyByApi(page: Page) {
  await expect.poll(() => page.evaluate(() => localStorage.getItem('pedos.account'))).not.toBeNull()
  const active = await page.evaluate(async () => {
    const library = localStorage.getItem('pedos.account') as string
    await fetch('/api/full-access/checkout/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-pedos-library': library },
      body: JSON.stringify({ returnTo: 'page', path: '/' })
    })
    await fetch('/api/dev/checkout/', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-pedos-library': library
      },
      body: new URLSearchParams({ return: 'page', path: '/' }),
      redirect: 'manual'
    })
    const access = await fetch('/api/full-access/', { headers: { 'x-pedos-library': library } })
    return ((await access.json()) as { active: boolean }).active
  })
  expect(active).toBe(true)
}

/** Records one fart and saves it, on to its Result. */
async function recordAResult(page: Page) {
  await waitForOpenMicrophone(page)
  await fartAndRecord(page, '095')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('result-note')).toBeVisible({ timeout: 30_000 })
}

/**
 * A new phone, past Welcome by allowing the microphone, as someone new gets here: a browser's steps
 * count only once it has counted `open`, on Welcome, and the account step and first Result are to come.
 */
async function aNewPhone(page: Page) {
  await page.goto('/')
  await allow(page).click()
  await expect(allow(page)).toBeHidden()
}

function tab(page: Page, label: string) {
  return page
    .getByRole('navigation', { name: 'Tabs' })
    .getByRole('link', { name: label, exact: true })
}

async function expectTappable(control: Locator) {
  await expect(async () => {
    const box = await control.boundingBox()
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  }).toPass({ timeout: 2_000 })
}

/** All of `surface` is on the screen, with nothing to scroll to. */
async function expectOnOneScreen(surface: Locator, height: number) {
  await expect(async () => {
    const box = await surface.boundingBox()
    expect(box?.y ?? -1).toBeGreaterThanOrEqual(0)
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(height)
    const { scrollHeight, clientHeight } = await surface.evaluate(element => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight
    }))
    expect(scrollHeight).toBeLessThanOrEqual(clientHeight)
  }).toPass({ timeout: 2_000 })
}

const SCREENS = [
  { width: 390, height: 844 },
  { width: 375, height: 667 },
  // Small iPhones, with Safari's bars.
  { width: 375, height: 553 },
  { width: 320, height: 568 }
]

test.describe('on Welcome', () => {
  test('a guest makes an account first, and skipping it there never asks again', async ({
    page
  }) => {
    const sent = offerStepsFrom(page)
    await page.goto('/')
    await welcomeOffer(page).click()

    const step = accountStep(page)
    await expect(step.getByRole('heading', { name: 'Make a free account' })).toBeVisible()
    await expect(step).toContainText('You need one for Full Access. It keeps your farts too.')
    await step.getByRole('button', { name: 'Not now' }).click()

    await expect(step).toBeHidden()
    await expect(allow(page)).toBeVisible()
    await expect(welcomeOffer(page)).toHaveCount(0)
    await page.reload()
    await expect(allow(page)).toBeVisible()
    await expect(welcomeOffer(page)).toHaveCount(0)
    await aMoment(page)
    expect(seen.sheet).toBe(false)
    expect(sent).toEqual([])

    // Welcome still works.
    await allow(page).click()
    await expect(page.getByTestId('record-button')).toBeVisible()
  })

  test('a guest with a new account sees the sheet with their email, and Not now is back to Welcome', async ({
    page
  }, testInfo) => {
    const sent = offerStepsFrom(page)
    const email = newEmail(testInfo, 'welcome-skip')
    await page.goto('/')
    await welcomeOffer(page).click()
    await signUpOnTheStep(page, email)

    const offer = sheet(page)
    await expect(offer.getByRole('heading', { name: 'Keep every Toot you make.' })).toBeVisible()
    await expect(offer).toContainText(`Buying for ${email}.`)
    await expect(offer).toContainText('Save up to 300 Toots, from Songs and the Sound Pad')
    await expect(offer).toContainText('Download any saved Toot as a file')
    await expect.poll(() => [...sent]).toEqual(['offer-welcome-shown'])

    await offer.getByRole('button', { name: 'Not now' }).click()
    await expect(offer).toBeHidden()
    await expect(allow(page)).toBeVisible()
    await expect(welcomeOffer(page)).toHaveCount(0)

    await page.reload()
    await expect(allow(page)).toBeVisible()
    await expect(welcomeOffer(page)).toHaveCount(0)
    await aMoment(page)
    expect(sent).toEqual(['offer-welcome-shown'])
  })

  test('a guest buys it, comes back to Welcome, and sees it confirmed', async ({
    page
  }, testInfo) => {
    const sent = offerStepsFrom(page)
    await page.goto('/')
    await welcomeOffer(page).click()
    await signUpOnTheStep(page, newEmail(testInfo, 'welcome-buy'))
    await expect(sheet(page)).toBeVisible()

    // Held, so the wait can be seen.
    await page.route(
      url => url.pathname === '/api/full-access/',
      async route => {
        await new Promise(resolve => setTimeout(resolve, 1_000))
        await route.fallback()
      }
    )
    await payOnTheOffer(page, '/')

    await expect(page.getByText('Confirming payment…')).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'Confirming' })).toBeInViewport()
    // Clear of Welcome's buttons.
    const note = await page.getByRole('status').filter({ hasText: 'Confirming' }).boundingBox()
    const first = await allow(page).boundingBox()
    expect((note?.y ?? 0) + (note?.height ?? 0)).toBeLessThanOrEqual(first?.y ?? 0)

    await expect(page.getByText(PAID)).toBeVisible({ timeout: 30_000 })
    await expect(page).toHaveURL(/\/$/)
    await expect(allow(page)).toBeVisible()
    await expect(welcomeOffer(page)).toHaveCount(0)
    expect(seen.sheet).toBe(true)
    expect(sent).toEqual(['offer-welcome-shown', 'offer-welcome-tapped'])
    expect(await page.evaluate(() => localStorage.getItem('pedos.fullAccess.paymentPending'))).toBe(
      null
    )

    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await ownClient(page.context())
    await page.reload()
    await expect(allow(page)).toBeVisible()
    await expect(page.getByText(PAID)).toBeHidden()
    await expect(page.getByText('Confirming payment…')).toBeHidden()
    await expect(welcomeOffer(page)).toHaveCount(0)

    await allow(page).click()
    await expect(page.getByTestId('record-button')).toBeVisible()
  })

  test('Cancel at Checkout is back on Welcome, with nothing paid and no asking again', async ({
    page
  }, testInfo) => {
    await page.goto('/')
    await signInByApi(page, newEmail(testInfo, 'welcome-cancel'))
    await page.reload()
    await welcomeOffer(page).click()
    await sheet(page).getByRole('button', { name: 'Pay $4.99' }).click()
    await expect(page).toHaveURL(/\/dev\/checkout\//)
    await page.getByRole('link', { name: 'Cancel' }).click()

    await expect(page).toHaveURL(/\/$/)
    await expect(allow(page)).toBeVisible()
    await expect(welcomeOffer(page)).toHaveCount(0)
    await expect(sheet(page)).toBeHidden()
    await expect(page.getByText('Confirming payment…')).toBeHidden()
  })

  test('someone signed in goes straight to the sheet, and someone with Full Access isn’t offered it', async ({
    page
  }, testInfo) => {
    await page.goto('/')
    await signInByApi(page, newEmail(testInfo, 'welcome-signed-in'))
    await page.reload()
    await welcomeOffer(page).click()
    await expect(sheet(page)).toBeVisible()
    await expect(accountStep(page)).toBeHidden()
    await sheet(page).getByRole('button', { name: 'Not now' }).click()
    await expect(welcomeOffer(page)).toHaveCount(0)

    // A new browser for the same account, which has it by now.
    await buyByApi(page)
    await page.evaluate(() => localStorage.removeItem('pedos.fullAccessOffer.welcome'))
    await page.reload()
    await expect(allow(page)).toBeVisible()
    // Its answer is in once Farty has asked, and the button never comes.
    await page.waitForResponse(r => new URL(r.url()).pathname === '/api/full-access/')
    await aMoment(page)
    await expect(welcomeOffer(page)).toBeHidden()
  })

  test('with no answer about Full Access, it isn’t offered', async ({ page }, testInfo) => {
    await page.goto('/')
    await signInByApi(page, newEmail(testInfo, 'welcome-offline'))
    await page.route(
      url => url.pathname === '/api/full-access/',
      route => route.abort()
    )
    await page.reload()
    await expect(allow(page)).toBeVisible()
    await aMoment(page)
    await expect(welcomeOffer(page)).toBeHidden()
    expect(seen.sheet).toBe(false)
  })

  test('a reload during the account step keeps the way to the offer', async ({
    page
  }, testInfo) => {
    const email = newEmail(testInfo, 'welcome-reload')
    await page.goto('/')
    await welcomeOffer(page).click()
    const step = accountStep(page)
    await step.getByLabel('Email').fill(email)
    await step.getByRole('button', { name: 'Send code' }).click()
    await expect(step.getByLabel('Code')).toBeVisible()

    await page.reload()
    await step.getByLabel('Code').fill(await codeFor(page, email))
    await step.getByRole('button', { name: 'Sign in' }).click()
    await expect(step).toBeHidden()

    await expect(sheet(page)).toBeHidden()
    await welcomeOffer(page).click()
    await expect(sheet(page)).toBeVisible()
    await expect(sheet(page)).toContainText(`Buying for ${email}.`)
  })

  test('all three buttons and the sheet fit each phone, down to the smallest', async ({
    page
  }, testInfo) => {
    await page.goto('/')
    await signInByApi(page, newEmail(testInfo, `welcome-fit-${'long'.repeat(8)}`))
    await page.reload()
    await expect(welcomeOffer(page)).toBeVisible()
    for (const screen of SCREENS) {
      await page.setViewportSize(screen)
      await expectOnOneScreen(page.getByTestId('welcome'), screen.height)
      for (const control of [
        allow(page),
        welcomeOffer(page),
        page.getByRole('button', { name: 'Not now' })
      ]) {
        await expect(control).toBeInViewport({ ratio: 1 })
        await expectTappable(control)
      }
      const icon = await page.locator('img[src*="welcome-icon"]').boundingBox()
      expect(icon?.y ?? -1).toBeGreaterThanOrEqual(0)
    }

    await welcomeOffer(page).click()
    await expect(sheet(page)).toBeVisible()
    for (const screen of SCREENS) {
      await page.setViewportSize(screen)
      await expectOnOneScreen(sheet(page), screen.height)
      await expectTappable(sheet(page).getByRole('button', { name: 'Pay $4.99' }))
      await expectTappable(sheet(page).getByRole('button', { name: 'Not now' }))
    }
  })

  test('going past Welcome without it, the first Result still has its go', async ({
    page
  }, testInfo) => {
    await page.goto('/')
    await signInByApi(page, newEmail(testInfo, 'welcome-past'))
    await page.reload()
    await expect(welcomeOffer(page)).toBeVisible()
    await allow(page).click()

    await recordAResult(page)
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(sheet(page)).toBeVisible()
  })
})

test.describe('at the first Result', () => {
  test('a guest skips at the account step, goes where they tapped, and isn’t asked again', async ({
    page
  }) => {
    const sent = offerStepsFrom(page)
    await aNewPhone(page)
    await recordAResult(page)
    await page.getByRole('button', { name: 'Done' }).click()

    const step = accountStep(page)
    await expect(step.getByRole('heading', { name: 'Keep your farts' })).toBeVisible()
    await step.getByRole('button', { name: 'Not now' }).click()
    await expect(step).toBeHidden()
    await expect(page).toHaveURL(/\/recordings\/$/)
    await expect(page.getByTestId('recording-row')).toHaveCount(1)

    await tab(page, 'Record').click()
    await recordAResult(page)
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(page).toHaveURL(/\/recordings\/$/)
    await expect(page.getByTestId('recording-row')).toHaveCount(2)
    expect(seen.sheet).toBe(false)
    expect(sent).toEqual([])
  })

  test('a guest with a new account sees the sheet once, and Not now goes where they tapped', async ({
    page
  }, testInfo) => {
    const sent = offerStepsFrom(page)
    const email = newEmail(testInfo, 'result-skip')
    await aNewPhone(page)
    await recordAResult(page)
    await page.getByRole('button', { name: 'Done' }).click()
    await signUpOnTheStep(page, email)

    const offer = sheet(page)
    await expect(
      offer.getByRole('heading', { name: 'Keep this Toot, and every one after it.' })
    ).toBeVisible()
    await expect(offer).toContainText(`Buying for ${email}.`)
    // Not until the sheet closes does Farty go where the tap said.
    await expect(page).not.toHaveURL(/\/recordings\/$/)
    await expect.poll(() => [...sent]).toEqual(['offer-result-shown'])

    await offer.getByRole('button', { name: 'Not now' }).click()
    await expect(offer).toBeHidden()
    await expect(page).toHaveURL(/\/recordings\/$/)
    await expect(page.getByTestId('recording-row')).toHaveCount(1)

    seen.sheet = false
    await tab(page, 'Record').click()
    await recordAResult(page)
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(page).toHaveURL(/\/recordings\/$/)
    expect(seen.sheet).toBe(false)
    await aMoment(page)
    expect(sent).toEqual(['offer-result-shown'])
  })

  test('a guest buys it, back where they tapped, with their Recording kept', async ({
    page
  }, testInfo) => {
    const sent = offerStepsFrom(page)
    await aNewPhone(page)
    await recordAResult(page)
    await page.getByRole('button', { name: 'Done' }).click()
    await signUpOnTheStep(page, newEmail(testInfo, 'result-buy'))
    await expect(sheet(page)).toBeVisible()
    await payOnTheOffer(page, '/recordings/')

    await expect(page.getByText(PAID)).toBeVisible({ timeout: 30_000 })
    await expect(page).toHaveURL(/\/recordings\/$/)
    await expect(page.getByTestId('recording-row')).toHaveCount(1)
    expect(sent).toEqual(['offer-result-shown', 'offer-result-tapped'])

    await page.reload()
    await expect(page.getByTestId('recording-row')).toHaveCount(1)
    await expect(page.getByText(PAID)).toBeHidden()
  })

  test('someone signed in goes straight to the sheet, and Pay comes back to Record another', async ({
    page
  }, testInfo) => {
    await aNewPhone(page)
    await signInByApi(page, newEmail(testInfo, 'result-signed-in'))
    await page.reload()
    await recordAResult(page)
    await page.getByRole('button', { name: 'Record another' }).click()
    await expect(sheet(page)).toBeVisible()
    await expect(accountStep(page)).toBeHidden()
    await payOnTheOffer(page, '/')
    await expect(page.getByText(PAID)).toBeVisible({ timeout: 30_000 })
    await expect(page).toHaveURL(/\/$/)
    // Record answers the next tap. Stop, which the note used to cover, is in the slow Result journey.
    await page.getByTestId('record-button').click({ timeout: 2_000 })
    await expect(page.getByTestId('stop-button')).toBeVisible()
  })

  test('someone with Full Access goes on with no sheet', async ({ page }, testInfo) => {
    await aNewPhone(page)
    await signInByApi(page, newEmail(testInfo, 'result-has-it'))
    await page.reload()
    await buyByApi(page)
    await page.reload()
    await recordAResult(page)
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(page).toHaveURL(/\/recordings\/$/)
    await aMoment(page)
    expect(seen.sheet).toBe(false)
  })

  test('with no answer about Full Access, it carries on and offers nothing', async ({
    page
  }, testInfo) => {
    await aNewPhone(page)
    await signInByApi(page, newEmail(testInfo, 'result-offline'))
    await page.reload()
    await recordAResult(page)
    await page.route(
      url => url.pathname === '/api/full-access/',
      route => route.abort()
    )
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(page).toHaveURL(/\/recordings\/$/)
    expect(seen.sheet).toBe(false)
  })

  test('a reload on the Result loses the Result, offers nothing, and the next isn’t the first', async ({
    page
  }, testInfo) => {
    await aNewPhone(page)
    await signInByApi(page, newEmail(testInfo, 'result-reload'))
    await page.reload()
    await recordAResult(page)
    await page.reload()
    await expect(page.getByTestId('result-note')).toBeHidden()
    await expect(page.getByTestId('record-button')).toBeVisible()
    await recordAResult(page)
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(page).toHaveURL(/\/recordings\/$/)
    expect(seen.sheet).toBe(false)
  })

  test('the sheet fits each phone, down to the smallest', async ({ page }, testInfo) => {
    await aNewPhone(page)
    await signInByApi(page, newEmail(testInfo, `result-fit-${'long'.repeat(8)}`))
    await page.reload()
    await recordAResult(page)
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(sheet(page)).toBeVisible()
    for (const screen of SCREENS) {
      await page.setViewportSize(screen)
      await expectOnOneScreen(sheet(page), screen.height)
      await expectTappable(sheet(page).getByRole('button', { name: 'Pay $4.99' }))
      await expectTappable(sheet(page).getByRole('button', { name: 'Not now' }))
    }
  })
})

test.describe('back from Checkout', () => {
  test('signed out, the account step opens once, and Not now ends the wait', async ({ page }) => {
    await page.addInitScript(skipWelcome)
    await page.goto('/?offer=done')
    const step = accountStep(page)
    await expect(step).toBeVisible()
    await step.getByRole('button', { name: 'Not now' }).click()
    await expect(step).toBeHidden()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByText('Confirming payment…')).toBeHidden()
  })

  test('a payment that’s slow says so, and nothing offers Pay again, until it comes', async ({
    page,
    request
  }, testInfo) => {
    test.setTimeout(300_000)
    await needsTheFixtureLibrary(request)
    await page.goto('/')
    await signInByApi(page, newEmail(testInfo, 'slow'))
    await page.reload()
    await welcomeOffer(page).click()
    await expect(sheet(page)).toBeVisible()

    // From here the account says no, as it does until the payment's word gets through.
    const slow = { paid: false }
    await page.route(
      url => url.pathname === '/api/full-access/',
      route =>
        slow.paid
          ? route.fallback()
          : route.fulfill({ json: { active: false, limitReached: false } })
    )
    await payOnTheOffer(page, '/')
    await expect(page).toHaveURL(/\?offer=done$/)
    seen.sheet = false

    await expect(page.getByText('Confirming payment…')).toBeVisible()
    await expect(page.getByText('Farty will check again when you save.')).toBeVisible({
      timeout: 60_000
    })
    await expect(page).toHaveURL(/\?offer=done$/)
    await expect(welcomeOffer(page)).toHaveCount(0)

    // A reload checks again, and still doesn't offer Pay.
    await page.reload()
    await expect(page).toHaveURL(/\?offer=done$/)
    await expect(page.getByText('Confirming payment…')).toBeVisible()
    await expect(page.getByText('Farty will check again when you save.')).toBeVisible({
      timeout: 60_000
    })
    await expect(welcomeOffer(page)).toHaveCount(0)
    expect(seen.sheet, 'a reload offered Pay to someone who just paid').toBe(false)

    await page.getByRole('button', { name: 'Not now' }).click()
    await tab(page, 'Profile').click()
    await loadTheFixtureLibrary(page)
    await tab(page, 'Compose').click()
    await page
      .getByTestId('unlocked-songs')
      .locator('[data-song="mary"]')
      .getByRole('link')
      .click({ timeout: 60_000 })
    await expect(page.getByTestId('song-creator-state')).toHaveText('Playing', { timeout: 60_000 })

    // Save waits on the same payment: it never opens the sheet that would start another Checkout.
    await page.getByRole('button', { name: 'Save to Toots' }).click()
    await expect(page.getByRole('button', { name: 'Confirming payment…' })).toBeVisible()
    await expect(page.getByText('Tap Save to check again.')).toBeVisible({ timeout: 60_000 })
    expect(seen.sheet, 'Save offered Pay to someone who just paid').toBe(false)

    slow.paid = true
    await page.getByRole('button', { name: 'Save to Toots' }).click()
    await expect(page.getByRole('button', { name: 'Saved to Toots' })).toBeDisabled({
      timeout: 60_000
    })
    expect(seen.sheet, 'Save offered Pay to someone who just paid').toBe(false)
    expect(await page.evaluate(() => localStorage.getItem('pedos.fullAccess.paymentPending'))).toBe(
      null
    )
  })

  test('with a payment on its way, the first Result doesn’t offer Pay', async ({
    page
  }, testInfo) => {
    const sent = offerStepsFrom(page)
    await page.goto('/')
    await signInByApi(page, newEmail(testInfo, 'slow-result'))
    await page.reload()
    await welcomeOffer(page).click()
    await expect(sheet(page)).toBeVisible()
    await page.route(
      url => url.pathname === '/api/full-access/',
      route => route.fulfill({ json: { active: false, limitReached: false } })
    )
    await payOnTheOffer(page, '/')
    await expect(page.getByText('Confirming payment…')).toBeVisible()
    seen.sheet = false

    await allow(page).click()
    await recordAResult(page)
    await page.getByRole('button', { name: 'Record another' }).click()
    await expect(page.getByTestId('record-button')).toBeVisible()
    await aMoment(page)
    expect(seen.sheet, 'the first Result offered Pay to someone who just paid').toBe(false)
    expect(sent).toEqual(['offer-welcome-shown', 'offer-welcome-tapped'])
  })

  test('from a Song’s page, it comes back to that Song, confirmed', async ({ page }, testInfo) => {
    await aNewPhone(page)
    await signInByApi(page, newEmail(testInfo, 'return-song'))
    await page.reload()
    const song = '/compose/mary/'
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('pedos.account')))
      .not.toBeNull()
    const started = await page.evaluate(async path => {
      const response = await fetch('/api/full-access/checkout/', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-pedos-library': localStorage.getItem('pedos.account') as string
        },
        body: JSON.stringify({ returnTo: 'page', path })
      })
      return response.ok
    }, song)
    expect(started).toBe(true)
    await page.goto(`/dev/checkout/?return=page&path=${encodeURIComponent(song)}`)
    await page.getByRole('button', { name: 'Pay $4.99' }).click()

    await expect(page.getByText(PAID)).toBeVisible({ timeout: 30_000 })
    await expect(page).toHaveURL(/\/compose\/mary\/$/)
  })
})

async function needsTheFixtureLibrary(request: APIRequestContext) {
  test.skip(
    !(await request.get('/fixtures/recordings/index.json')).ok(),
    'Toots need the Fixture Library, which only the Staging build has (pnpm build:staging)'
  )
}

/** Loads the Fixture Library from Profile, which unlocks Mary Had a Little Lamb, among others. */
async function loadTheFixtureLibrary(page: Page) {
  const library = page.getByTestId('fixture-library')
  await library.getByRole('button', { name: 'Load the Fixture Library' }).click()
  await expect(library.getByRole('button', { name: 'Fixture Library loaded' })).toBeDisabled({
    timeout: 90_000
  })
}
