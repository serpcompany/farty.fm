import { codeFor, newEmail, ownClient, reopen, session } from './account'
import { persistAsked, standInForPersist } from './database'
import { recordG3, skipWelcome, withFartingMicrophone } from './record'
import { comeBack, expectTappable, onPhone } from './screens'
import { expect, test } from './test'

withFartingMicrophone({ welcomed: false })
test.skip(({ viewport }) => !onPhone({ viewport }), 'The account step is checked at phone size')

const guestNote =
  'Without an account, your Recordings stay only in this browser, and your Toots are gone when you close Farty.'

test("a guest's first Result offers the account step, and Not now goes where they tapped", async ({
  page
}) => {
  await recordG3(page, { offersAccount: true })
  await page.getByRole('button', { name: 'Done' }).click()

  const step = page.getByRole('dialog', { name: 'Keep your farts' })
  await expect(step).toBeVisible()
  await expect(step.getByRole('heading', { name: 'Keep your farts' })).toBeFocused()
  await expect(step).toContainText(
    'Make a free account to keep your Recordings and Toots, even on a new phone.'
  )
  await expect(step.getByTestId('account-step-guest')).toHaveText(guestNote)
  for (const control of [
    step.getByLabel('Email'),
    step.getByRole('button', { name: 'Send code' }),
    step.getByRole('link', { name: 'Privacy' }),
    step.getByRole('button', { name: 'Not now' })
  ]) {
    await expectTappable(control)
  }
  await expect(page).not.toHaveURL(/\/recordings\/$/)

  await step.getByRole('button', { name: 'Not now' }).click()
  await expect(step).toBeHidden()
  await expect(page).toHaveURL(/\/recordings\/$/)
  await expect(page.getByTestId('recording-row')).toHaveCount(1)
  expect(await page.evaluate(() => localStorage.getItem('pedos.accountStep'))).toBe('once')
})

test('signing up from the first Result keeps the Recording, and goes where they tapped', async ({
  page,
  pageErrors
}, testInfo) => {
  test.setTimeout(120_000)
  pageErrors.expect('the server responded with a status of 400')
  const email = newEmail(testInfo, 'step')
  await ownClient(page.context())
  await page.addInitScript(standInForPersist)

  await recordG3(page, { offersAccount: true })
  await page.getByRole('button', { name: 'Record another' }).click()
  const step = page.getByRole('dialog', { name: 'Keep your farts' })
  await step.getByLabel('Email').fill(email)
  await step.getByRole('button', { name: 'Send code' }).click()

  const code = step.getByLabel('Code')
  await expect(code).toBeFocused()
  await expect(step).toContainText(`We sent a 6-digit code to ${email}.`)
  for (const control of [
    code,
    step.getByRole('button', { name: 'Sign in' }),
    step.getByRole('button', { name: 'Change email' })
  ]) {
    await expectTappable(control)
  }
  const right = await codeFor(page, email)
  await code.fill(right === '000000' ? '111111' : '000000')
  await step.getByRole('button', { name: 'Sign in' }).click()
  await expect(step.getByRole('alert')).toHaveText("That code isn't right. Check it and try again.")
  await code.fill(right)
  await step.getByRole('button', { name: 'Sign in' }).click()

  await expect(step).toBeHidden()
  await expect(page).toHaveURL(/:\d+\/$/)
  await expect(page.getByTestId('record-button')).toBeVisible()
  expect((await session(page))?.user.email).toBe(email)
  expect(await persistAsked(page)).toBe(true)

  const reopened = await reopen(page.context(), page)
  await expect(reopened.getByTestId('recording-row')).toHaveCount(1)
  expect(await reopened.evaluate(() => localStorage.getItem('pedos.accountStep'))).toBe('done')
})

test("Profile's Save to an account opens the step, which stays while they read their email", async ({
  page
}) => {
  await page.addInitScript(skipWelcome)
  await page.goto('/profile/')
  const save = page.getByRole('button', { name: 'Save to an account' })
  await expectTappable(save)
  await expect(page.getByText(guestNote)).toBeVisible()
  await save.click()
  const step = page.getByRole('dialog', { name: 'Keep your farts' })
  await expect(step).toBeVisible()
  await step.getByLabel('Email').fill('later@example.com')

  await comeBack(page)
  await expect(step).toBeVisible()
  await expect(page).toHaveURL(/\/profile\/$/)
  await step.getByRole('button', { name: 'Not now' }).click()
  await expect(step).toBeHidden()
  await expect(page).toHaveURL(/\/profile\/$/)
  await expect(save).toBeFocused()

  await page.reload()
  await expect(save).toBeVisible()
  await expect(step).toBeHidden()
})

test('a reload while they read their email comes back to the code, which still signs in', async ({
  page
}, testInfo) => {
  test.setTimeout(120_000)
  const email = newEmail(testInfo, 'reload')
  await ownClient(page.context())
  await page.addInitScript(skipWelcome)
  await page.goto('/profile/')
  await page.getByRole('button', { name: 'Save to an account' }).click()
  const step = page.getByRole('dialog', { name: 'Keep your farts' })
  await step.getByLabel('Email').fill(email)
  await step.getByRole('button', { name: 'Send code' }).click()
  await expect(step.getByLabel('Code')).toBeFocused()

  await page.reload()
  await expect(step).toContainText(`We sent a 6-digit code to ${email}.`)
  await expect(step.getByLabel('Code')).toBeFocused()
  await step.getByLabel('Code').fill(await codeFor(page, email))
  await step.getByRole('button', { name: 'Sign in' }).click()
  await expect(step).toBeHidden()
  await expect(page.getByTestId('account-email')).toHaveText(email)
  await page.reload()
  await expect(page.getByTestId('account-email')).toHaveText(email)
  await expect(step).toBeHidden()
})
