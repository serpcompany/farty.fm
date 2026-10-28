import type { Page } from '@playwright/test'
import { accountOf, newEmail, session, signInByApi } from './account'
import { stored } from './database'
import { g3Fart, recordG3ToRecordings, skipWelcome, withFakeMicrophone } from './record'
import { expectTappable, onPhone, tab } from './screens'
import { expect, test } from './test'

withFakeMicrophone(g3Fart)
test.skip(({ viewport }) => !onPhone({ viewport }), 'The account step is checked at phone size')

async function signedInWithARecording(page: Page, email: string) {
  await recordG3ToRecordings(page)
  await signInByApi(page, email)
  await page.goto('/profile/')
}

async function signedInWithARecordingNotUploaded(page: Page, email: string) {
  await page.addInitScript(skipWelcome)
  await page.goto('/profile/')
  await signInByApi(page, email)
  await page.route('**/api/recordings/**', route => route.abort('internetdisconnected'))
  await recordG3ToRecordings(page)
  await tab(page, 'Profile').click()
  await page.getByRole('button', { name: 'Sign out' }).click()
}

async function expectSignedOutWithNothingHere(page: Page) {
  await expect(page.getByRole('button', { name: 'Save to an account' })).toBeVisible()
  expect(await session(page)).toBeNull()
  expect(await stored(page, 'recordings')).toBe(0)
}

test("Profile's account: the email, Farty news, and Sign out, which leaves nothing here", async ({
  page
}, testInfo) => {
  test.setTimeout(120_000)
  const email = newEmail(testInfo, 'profile')
  await signedInWithARecording(page, email)

  await expect(page.getByTestId('account-email')).toHaveText(email)
  const news = page.getByRole('switch', { name: 'Farty news' })
  await expect(news).toBeChecked()
  for (const control of [
    page.locator('label', { has: news }),
    page.getByRole('button', { name: 'Sign out' }),
    page.getByRole('button', { name: 'Delete account' })
  ]) {
    await expectTappable(control)
  }
  await page.locator('label', { has: news }).click()
  await expect(news).not.toBeChecked()
  await page.reload()
  await expect(news).not.toBeChecked()
  expect((await session(page))?.user).toMatchObject({ email, marketingEmail: false })
  await news.click()
  await expect(news).toBeChecked()

  await page.getByRole('button', { name: 'Sign out' }).click()
  await expectSignedOutWithNothingHere(page)
  await expect(page).toHaveURL(/\/profile\/$/)
  await expect(page.getByTestId('stat-recordings')).toHaveText('Recordings0')
  expect(await accountOf(page)).toBeNull()
})

test("Sign out uploads the farts not uploaded yet, and while it can't, Wait keeps the account", async ({
  page,
  pageErrors
}, testInfo) => {
  test.setTimeout(120_000)
  pageErrors.expect('net::ERR_INTERNET_DISCONNECTED')
  const email = newEmail(testInfo, 'pending')
  await signedInWithARecordingNotUploaded(page, email)
  const dialog = page.getByRole('alertdialog', { name: 'Not uploaded yet' })
  await expect(dialog).toContainText(
    "Some farts on this device haven't reached your account. Check your connection and wait, or sign out now and lose them."
  )
  const wait = dialog.getByRole('button', { name: 'Wait' })
  for (const control of [wait, dialog.getByRole('button', { name: 'Sign out anyway' })]) {
    await expectTappable(control)
  }
  await page.screenshot({ path: testInfo.outputPath('not-uploaded.png') })
  await wait.click()
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('account-email')).toHaveText(email)
  expect((await session(page))?.user.email).toBe(email)
  expect(await stored(page, 'recordings')).toBe(1)

  await page.unrouteAll()
  const sent: string[] = []
  page.on('request', request => sent.push(`${request.method()} ${new URL(request.url()).pathname}`))
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('button', { name: 'Save to an account' })).toBeVisible()
  expect(await stored(page, 'recordings')).toBe(0)
  const upload = sent.findIndex(line => /^PUT \/api\/recordings\/[\w-]+\/$/.test(line))
  expect(upload).toBeGreaterThanOrEqual(0)
  expect(upload).toBeLessThan(sent.indexOf('POST /api/auth/sign-out'))

  await signInByApi(page, email)
  await page.goto('/recordings/')
  await expect(page.getByTestId('recording-row')).toHaveCount(1)
  await expect(page.getByRole('button', { name: /^Recording 1, \d+\.\d s, G3$/ })).toBeVisible()
})

test('Sign out anyway signs out and leaves behind the farts not uploaded', async ({
  page,
  pageErrors
}, testInfo) => {
  test.setTimeout(120_000)
  pageErrors.expect('net::ERR_INTERNET_DISCONNECTED')
  const email = newEmail(testInfo, 'anyway')
  await signedInWithARecordingNotUploaded(page, email)
  await page
    .getByRole('alertdialog', { name: 'Not uploaded yet' })
    .getByRole('button', { name: 'Sign out anyway' })
    .click()
  await expectSignedOutWithNothingHere(page)

  await page.unrouteAll()
  await signInByApi(page, email)
  await page.goto('/recordings/')
  await expect(page.getByText('No Recordings yet')).toBeVisible()
})

test('Delete account asks first, then deletes the account and leaves nothing here', async ({
  page,
  pageErrors
}, testInfo) => {
  test.setTimeout(120_000)
  pageErrors.expect('the server responded with a status of 401')
  const email = newEmail(testInfo, 'delete')
  await signedInWithARecording(page, email)

  await page.getByRole('button', { name: 'Delete account' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Delete your account?' })
  await expect(dialog).toContainText("It can't be undone.")
  for (const name of ['Cancel', 'Delete']) {
    await expectTappable(dialog.getByRole('button', { name }))
  }
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('account-email')).toHaveText(email)

  await page.getByRole('button', { name: 'Delete account' }).click()
  await dialog.getByRole('button', { name: 'Delete' }).click()
  await expectSignedOutWithNothingHere(page)
  await expect(page).toHaveURL(/\/profile\/$/)
  await expect(page.getByTestId('stat-recordings')).toHaveText('Recordings0')
  expect(await page.evaluate(async () => (await fetch('/api/library/')).status)).toBe(401)
})

test('Profile left open on one account never changes or deletes the account another tab signed in to', async ({
  page,
  context,
  pageErrors
}, testInfo) => {
  test.setTimeout(150_000)
  pageErrors.expect('the server responded with a status of 409')
  const first = newEmail(testInfo, 'first')
  const second = newEmail(testInfo, 'second')
  await context.addInitScript(skipWelcome)
  await page.goto('/profile/')
  await signInByApi(page, first)
  await page.goto('/profile/')
  await expect(page.getByTestId('account-email')).toHaveText(first)
  const other = await context.newPage()
  await other.goto('/profile/')
  const signInElsewhere = async (email: string) => {
    await signInByApi(other, email)
    await other.reload()
    await expect(other.getByTestId('account-email')).toHaveText(email)
  }

  await signInElsewhere(second)
  await page.getByRole('switch', { name: 'Farty news' }).click()
  await expect(page.getByTestId('account-email')).toHaveText(second)
  await expect(page.getByRole('switch', { name: 'Farty news' })).toBeChecked()
  expect((await session(page))?.user.marketingEmail).not.toBe(false)

  await signInElsewhere(first)
  await page.getByRole('button', { name: 'Delete account' }).click()
  await page
    .getByRole('alertdialog', { name: 'Delete your account?' })
    .getByRole('button', { name: 'Delete' })
    .click()
  await expect(page.getByTestId('account-email')).toHaveText(first)
  expect((await session(page))?.user.email).toBe(first)
  expect(await page.evaluate(async () => (await fetch('/api/library/')).status)).toBe(200)
})

test("Sign out clears Farty's other tabs too, without a reload", async ({
  page,
  context
}, testInfo) => {
  test.setTimeout(120_000)
  await page.addInitScript(skipWelcome)
  await page.goto('/profile/')
  await signInByApi(page, newEmail(testInfo, 'tabs'))
  await recordG3ToRecordings(page)
  const other = await context.newPage()
  await other.goto('/recordings/')
  await expect(other.getByTestId('recording-row')).toHaveCount(1)

  await tab(page, 'Profile').click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('button', { name: 'Save to an account' })).toBeVisible()
  await expect(other.getByTestId('recording-row')).toHaveCount(0)
})

test("Profile retries an account it couldn't reach, and reads it again back online", async ({
  page,
  pageErrors
}) => {
  pageErrors.expect('net::ERR_INTERNET_DISCONNECTED')
  const unreachable = () =>
    page.route('**/api/auth/get-session*', route => route.abort('internetdisconnected'))
  await page.addInitScript(skipWelcome)
  await unreachable()
  await page.goto('/profile/')
  await expect(page.getByText("Can't reach your account right now.")).toBeVisible()
  const retry = page.getByRole('button', { name: 'Retry' })
  await expectTappable(retry)

  await page.unrouteAll()
  await retry.click()
  const save = page.getByRole('button', { name: 'Save to an account' })
  await expect(save).toBeVisible()

  await unreachable()
  await page.reload()
  await expect(retry).toBeVisible()
  await page.unrouteAll()
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(save).toBeVisible()
})
