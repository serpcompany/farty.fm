import { expect, type Locator, type Page, test } from '@playwright/test'
import { codeFor, newEmail, ownClient, signInByApi } from './account'
import {
  fakeMicrophone,
  fartAndRecord,
  fixtureWavs,
  getUserMediaMs,
  waitForOpenMicrophone
} from './fake-microphone'
import { skipWelcome } from './record'
import { aMoment, stepsFrom } from './steps'

// The two offers of Full Access before Save (#407), on Welcome and at the first Result, at phone
// size: each skipped and each bought at the dev checkout, never two sheets at once, and each count
// once per browser. Paying with Stripe's own page is in `payments.workers.test.ts`, its API stubbed.

test.use({ permissions: ['microphone'] })

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'Welcome, where the first offer is, is phone-only')
  test.setTimeout(120_000)
  await ownClient(page.context())
  await page.addInitScript(fakeMicrophone, { wavs: fixtureWavs(), delayMs: getUserMediaMs })
})

const welcomeOffer = (page: Page) => page.getByRole('button', { name: 'Get Full Access for $4.99' })
const allowMicrophone = (page: Page) => page.getByRole('button', { name: 'Allow microphone' })
const sheet = (page: Page) => page.getByTestId('full-access-sheet')
const confirmation = (page: Page) => page.getByTestId('full-access-confirmation')

/** What an offer can put on screen, each a dialog. A Result is one too, under them. */
const overlays = (page: Page) =>
  page
    .getByRole('dialog', { name: /^(Make a free account|Keep your farts)$/ })
    .or(sheet(page))
    .or(confirmation(page))

/** One thing at a time: the step, or a sheet, and never one over another. */
async function expectOneOnScreen(page: Page, shown: Locator): Promise<void> {
  await expect(shown).toBeVisible()
  await expect(overlays(page)).toHaveCount(1)
}

async function expectNothingOver(page: Page): Promise<void> {
  await expect(overlays(page)).toHaveCount(0)
}

async function signInAtTheStep(page: Page, step: Locator, email: string): Promise<void> {
  await step.getByLabel('Email').fill(email)
  await step.getByRole('button', { name: 'Send code' }).click()
  // Once it shows, the newest code in the mailbox is this one, not one from an earlier sign-in.
  await expect(step.getByLabel('Code')).toBeVisible()
  await step.getByLabel('Code').fill(await codeFor(page, email))
  await step.getByRole('button', { name: 'Sign in' }).click()
}

/** The account's Full Access, as the server has it. */
function hasFullAccess(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const session = await fetch('/api/auth/get-session')
    const { user } = (await session.json()) as { user: { id: string } }
    const access = await fetch('/api/full-access/?check=stored', {
      headers: { 'x-pedos-library': user.id }
    })
    return ((await access.json()) as { active: boolean }).active
  })
}

/** Skips Welcome on a browser that has counted its open, with both first-Result offers to come. */
async function atRecordOnANewBrowser(page: Page): Promise<void> {
  await page.addInitScript(skipWelcome, { offersAccount: true, offersFullAccess: true })
  await page.addInitScript(() => {
    if (localStorage.getItem('pedos.steps') === null) {
      localStorage.setItem('pedos.steps', JSON.stringify({ open: 'sent' }))
    }
  })
}

/** Records and saves one fart, on to its Result. */
async function firstResult(page: Page): Promise<void> {
  await waitForOpenMicrophone(page)
  await fartAndRecord(page, '095')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('result-note')).toBeVisible()
}

test.describe('on Welcome', () => {
  test('a guest can skip it at every turn, and it counts once', async ({ page }) => {
    const sent = stepsFrom(page)
    await page.goto('/')
    await expect(welcomeOffer(page)).toBeEnabled()
    await expect(allowMicrophone(page)).toBeVisible()
    await expect.poll(() => [...sent]).toEqual(['open', 'offer-welcome-shown'])

    // A guest makes an account first, over Welcome, and no sheet opens with it.
    await welcomeOffer(page).click()
    const step = page.getByRole('dialog', { name: 'Make a free account' })
    await expectOneOnScreen(page, step)
    await expect(step).toContainText('You need one for Full Access. It keeps your farts too.')
    await expect(sheet(page)).toBeHidden()
    await expect.poll(() => [...sent]).toContain('offer-welcome-tapped')

    await step.getByRole('button', { name: 'Not now' }).click()
    await expectNothingOver(page)
    await expect(allowMicrophone(page)).toBeVisible()

    // Tapped again, after a reload, it opens again and counts nothing more.
    await page.reload()
    await welcomeOffer(page).click()
    await expectOneOnScreen(page, step)
    await step.getByRole('button', { name: 'Not now' }).click()
    await aMoment(page)
    expect(sent).toEqual(['open', 'offer-welcome-shown', 'offer-welcome-tapped'])

    // And Welcome still ends without it.
    await page.getByRole('button', { name: 'Not now' }).click()
    await expect(allowMicrophone(page)).toBeHidden()
    await expect(page.getByTestId('record-button')).toBeVisible()
  })

  test('signed in at the step, the sheet follows it, and Not now stays on Welcome', async ({
    page
  }, testInfo) => {
    await page.goto('/')
    await welcomeOffer(page).click()
    const step = page.getByRole('dialog', { name: 'Make a free account' })
    await signInAtTheStep(page, step, newEmail(testInfo, 'welcome-skip'))
    await expect(step).toBeHidden()
    await expectOneOnScreen(page, sheet(page))
    await expect(sheet(page)).toContainText('$4.99, once.')

    await sheet(page).getByRole('button', { name: 'Not now' }).click()
    await expectNothingOver(page)
    await expect(allowMicrophone(page)).toBeVisible()
    await expect(welcomeOffer(page)).toBeEnabled()
    expect(await hasFullAccess(page)).toBe(false)
  })

  test('bought, it confirms on the way back, and the button goes', async ({ page }, testInfo) => {
    const sent = stepsFrom(page)
    await page.goto('/')
    await welcomeOffer(page).click()
    await signInAtTheStep(
      page,
      page.getByRole('dialog', { name: 'Make a free account' }),
      newEmail(testInfo, 'welcome-buy')
    )
    await sheet(page).getByRole('button', { name: 'Pay $4.99' }).click()
    await expect(page).toHaveURL(/\/dev\/checkout\/\?offer=welcome$/)
    await page.getByRole('button', { name: 'Pay $4.99' }).click()

    await expectOneOnScreen(page, confirmation(page))
    await expect(confirmation(page)).toContainText('You have Full Access')
    await expect(page).toHaveURL(/\/$/)
    expect(await hasFullAccess(page)).toBe(true)
    await confirmation(page).getByRole('button', { name: 'OK' }).click()
    await expectNothingOver(page)

    // Back on Welcome, which carries on to the microphone, and never offers it again.
    await expect(allowMicrophone(page)).toBeVisible()
    await expect(welcomeOffer(page)).toBeHidden()
    await page.reload()
    await expect(allowMicrophone(page)).toBeVisible()
    await expect(confirmation(page)).toBeHidden()
    await expect(welcomeOffer(page)).toBeHidden()
    await aMoment(page)
    for (const once of ['open', 'offer-welcome-shown', 'offer-welcome-tapped', 'account']) {
      expect(sent.filter(step => step === once)).toHaveLength(1)
    }
  })

  test('a reload on the way back confirms again', async ({ page }, testInfo) => {
    await page.goto('/')
    await welcomeOffer(page).click()
    await signInAtTheStep(
      page,
      page.getByRole('dialog', { name: 'Make a free account' }),
      newEmail(testInfo, 'welcome-reload')
    )
    await sheet(page).getByRole('button', { name: 'Pay $4.99' }).click()
    await expect(page).toHaveURL(/\/dev\/checkout\//)
    // Held, so the confirmation is still waiting when the reload comes.
    await page.route('**/api/full-access/', async route => {
      await new Promise(resolve => setTimeout(resolve, 1_000))
      await route.continue().catch(() => {})
    })
    await page.getByRole('button', { name: 'Pay $4.99' }).click()
    await expect(confirmation(page)).toContainText('Confirming your payment')
    await expect(page).toHaveURL(/\/\?offer=welcome&checkout=done$/)
    await page.reload()
    await expect(confirmation(page)).toContainText('You have Full Access')
    await expect(page).toHaveURL(/\/$/)
  })

  test('cancelled at Checkout, Welcome stays as it was', async ({ page }, testInfo) => {
    await page.goto('/')
    await welcomeOffer(page).click()
    await signInAtTheStep(
      page,
      page.getByRole('dialog', { name: 'Make a free account' }),
      newEmail(testInfo, 'welcome-cancel')
    )
    await sheet(page).getByRole('button', { name: 'Pay $4.99' }).click()
    await expect(page).toHaveURL(/\/dev\/checkout\/\?offer=welcome$/)
    await page.getByRole('link', { name: 'Cancel' }).click()

    await expect(allowMicrophone(page)).toBeVisible()
    await expect(page).toHaveURL(/\/$/)
    await expectNothingOver(page)
    await expect(welcomeOffer(page)).toBeEnabled()
    expect(await hasFullAccess(page)).toBe(false)
  })

  test('a guest signing in to an account that has it hears so, with no sheet', async ({
    page
  }, testInfo) => {
    const email = newEmail(testInfo, 'welcome-held')
    await page.goto('/')
    await welcomeOffer(page).click()
    await signInAtTheStep(page, page.getByRole('dialog', { name: 'Make a free account' }), email)
    await sheet(page).getByRole('button', { name: 'Pay $4.99' }).click()
    await page.getByRole('button', { name: 'Pay $4.99' }).click()
    await confirmation(page).getByRole('button', { name: 'OK' }).click()

    // Another browser, as far as Farty can tell: signed out, with nothing kept.
    await page.context().clearCookies()
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    await welcomeOffer(page).click()
    await signInAtTheStep(page, page.getByRole('dialog', { name: 'Make a free account' }), email)
    await expectOneOnScreen(page, confirmation(page))
    await expect(confirmation(page)).toContainText('You have Full Access')
    await expect(sheet(page)).toBeHidden()
    await confirmation(page).getByRole('button', { name: 'OK' }).click()
    await expect(welcomeOffer(page)).toBeHidden()
    await expect(allowMicrophone(page)).toBeVisible()
  })
})

test.describe('at the first Result', () => {
  test('a guest’s Not now on the step goes where they tapped, with no sheet, and never again', async ({
    page
  }) => {
    await atRecordOnANewBrowser(page)
    const sent = stepsFrom(page)
    await page.goto('/')
    await firstResult(page)
    await page.getByRole('button', { name: 'Record another' }).click()

    const step = page.getByRole('dialog', { name: 'Keep your farts' })
    await expectOneOnScreen(page, step)
    await step.getByRole('button', { name: 'Not now' }).click()
    await expectNothingOver(page)

    await firstResult(page)
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(page).toHaveURL(/\/recordings\/$/)
    await expectNothingOver(page)
    await aMoment(page)
    expect(sent).not.toContain('offer-result-shown')
    expect(sent).not.toContain('offer-result-tapped')
  })

  test('signed in at the step, the sheet follows it, and Not now goes where they tapped', async ({
    page
  }, testInfo) => {
    await atRecordOnANewBrowser(page)
    const sent = stepsFrom(page)
    await page.goto('/')
    await firstResult(page)
    await page.getByRole('button', { name: 'Done' }).click()

    const step = page.getByRole('dialog', { name: 'Keep your farts' })
    await expectOneOnScreen(page, step)
    await expect(sheet(page)).toBeHidden()
    await signInAtTheStep(page, step, newEmail(testInfo, 'result-skip'))
    await expect(step).toBeHidden()
    await expectOneOnScreen(page, sheet(page))
    // Not until the sheet closes does Farty go where the tap said.
    await expect(page).not.toHaveURL(/\/recordings\/$/)
    await expect.poll(() => [...sent]).toContain('offer-result-shown')

    await sheet(page).getByRole('button', { name: 'Not now' }).click()
    await expect(page).toHaveURL(/\/recordings\/$/)
    await expectNothingOver(page)
    expect(await hasFullAccess(page)).toBe(false)
    await aMoment(page)
    expect(sent).not.toContain('offer-result-tapped')
    expect(sent.filter(step => step === 'offer-result-shown')).toHaveLength(1)
  })

  test('bought, it confirms, and then goes where they tapped', async ({ page }, testInfo) => {
    await atRecordOnANewBrowser(page)
    const sent = stepsFrom(page)
    await page.goto('/')
    await firstResult(page)
    await page.getByRole('button', { name: 'Record another' }).click()
    await signInAtTheStep(
      page,
      page.getByRole('dialog', { name: 'Keep your farts' }),
      newEmail(testInfo, 'result-buy')
    )
    await sheet(page).getByRole('button', { name: 'Pay $4.99' }).click()
    await expect(page).toHaveURL(/\/dev\/checkout\/\?offer=result$/)
    await page.getByRole('button', { name: 'Pay $4.99' }).click()

    await expectOneOnScreen(page, confirmation(page))
    await expect(confirmation(page)).toContainText('You have Full Access')
    await expect(page).toHaveURL(/\/recordings\/$/)
    expect(await hasFullAccess(page)).toBe(true)
    await confirmation(page).getByRole('button', { name: 'OK' }).click()
    await expectNothingOver(page)
    await expect(page.getByTestId('record-button')).toBeVisible()
    await expect(page).toHaveURL(/\/$/)

    await aMoment(page)
    for (const once of ['account', 'offer-result-shown', 'offer-result-tapped']) {
      expect(sent.filter(step => step === once)).toHaveLength(1)
    }
  })

  test('cancelled at Checkout, it goes where they tapped, and doesn’t offer again', async ({
    page
  }, testInfo) => {
    await atRecordOnANewBrowser(page)
    await page.goto('/')
    await firstResult(page)
    await page.getByRole('button', { name: 'Record another' }).click()
    await signInAtTheStep(
      page,
      page.getByRole('dialog', { name: 'Keep your farts' }),
      newEmail(testInfo, 'result-cancel')
    )
    await sheet(page).getByRole('button', { name: 'Pay $4.99' }).click()
    await expect(page).toHaveURL(/\/dev\/checkout\/\?offer=result$/)
    await page.getByRole('link', { name: 'Cancel' }).click()

    await expect(page.getByTestId('record-button')).toBeVisible()
    await expect(page).toHaveURL(/\/$/)
    await expectNothingOver(page)
    await firstResult(page)
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(page).toHaveURL(/\/recordings\/$/)
    await expectNothingOver(page)
  })

  test('when Pay can’t start, it says why, and Close goes where they tapped', async ({
    page
  }, testInfo) => {
    await atRecordOnANewBrowser(page)
    await page.goto('/privacy/')
    await signInByApi(page, newEmail(testInfo, 'result-failed'))
    await page.route('**/api/full-access/checkout/', route =>
      route.fulfill({ status: 503, json: { error: 'payments_unavailable' } })
    )
    await page.goto('/')
    await firstResult(page)
    await page.getByRole('button', { name: 'Done' }).click()
    await sheet(page).getByRole('button', { name: 'Pay $4.99' }).click()

    await expectOneOnScreen(page, confirmation(page))
    await expect(confirmation(page)).toContainText("Payments aren't available right now.")
    await expect(sheet(page)).toBeHidden()
    await confirmation(page).getByRole('button', { name: 'Close' }).click()
    await expect(page).toHaveURL(/\/recordings\/$/)
    await expectNothingOver(page)
  })

  test('already signed in, the sheet opens with no step', async ({ page }, testInfo) => {
    await atRecordOnANewBrowser(page)
    await page.goto('/privacy/')
    await signInByApi(page, newEmail(testInfo, 'result-signed-in'))
    const sent = stepsFrom(page)
    await page.goto('/')
    await firstResult(page)
    await page.getByRole('button', { name: 'Done' }).click()
    await expectOneOnScreen(page, sheet(page))
    await expect.poll(() => [...sent]).toContain('offer-result-shown')
    await sheet(page).getByRole('button', { name: 'Not now' }).click()
    await expect(page).toHaveURL(/\/recordings\/$/)
    await expectNothingOver(page)
  })

  test('bought on Welcome, the first Result offers nothing', async ({ page }, testInfo) => {
    const sent = stepsFrom(page)
    await page.goto('/privacy/')
    await signInByApi(page, newEmail(testInfo, 'result-held'))
    await page.goto('/')
    await welcomeOffer(page).click()
    await sheet(page).getByRole('button', { name: 'Pay $4.99' }).click()
    await page.getByRole('button', { name: 'Pay $4.99' }).click()
    await confirmation(page).getByRole('button', { name: 'OK' }).click()
    await allowMicrophone(page).click()

    await firstResult(page)
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(page).toHaveURL(/\/recordings\/$/)
    await expectNothingOver(page)
    await aMoment(page)
    expect(sent).not.toContain('offer-result-shown')
  })

  test('a browser that has recorded before isn’t at its first Result', async ({
    page
  }, testInfo) => {
    await atRecordOnANewBrowser(page)
    await page.goto('/privacy/')
    await signInByApi(page, newEmail(testInfo, 'result-second'))
    const sent = stepsFrom(page)
    await page.goto('/')
    await firstResult(page)
    // Left without a tap, the next take is the second.
    await page.reload()
    await firstResult(page)
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(page).toHaveURL(/\/recordings\/$/)
    await expectNothingOver(page)
    await aMoment(page)
    expect(sent).not.toContain('offer-result-shown')
  })
})
