import {
  accountOf,
  codeFor,
  expiredWithARecording,
  newEmail,
  reopen,
  session,
  signInByApi
} from './account'
import { stored } from './database'
import { g3Fart, recordAndSave, recordG3ToRecordings, withFakeMicrophone } from './record'
import { expectTappable, onPhone, tab } from './screens'
import { expect, test } from './test'

withFakeMicrophone(g3Fart)
test.skip(({ viewport }) => !onPhone({ viewport }), 'The account step is checked at phone size')
test.describe.configure({ timeout: 150_000 })

test.beforeEach(({ pageErrors }) => {
  pageErrors.expect('the server responded with a status of 401')
})

test("an account's farts stay when its session ends: Farty asks to sign in again, or clears them", async ({
  page,
  context
}, testInfo) => {
  await recordG3ToRecordings(page)
  await signInByApi(page, newEmail(testInfo, 'expired'))
  await page.reload()
  await expect(page.getByTestId('recording-row')).toHaveCount(1)
  await context.clearCookies()
  const reopened = await reopen(context, page)
  const step = reopened.getByRole('dialog', { name: 'Sign in again' })
  await expect(step).toBeVisible()
  await expect(step).toContainText('Your farts stay on this device until you sign in.')
  await expect(step.getByTestId('account-step-guest')).toHaveCount(0)
  await step.getByRole('button', { name: 'Not now' }).click()
  await expect(reopened.getByTestId('recording-row')).toHaveCount(1)
  expect(await stored(reopened, 'recordings')).toBe(1)

  await reopened.goto('/profile/')
  const again = reopened.getByRole('button', { name: 'Sign in again' })
  await expectTappable(again)
  await expect(step).toBeHidden()

  const clear = reopened.getByRole('button', { name: 'Clear this device' })
  await expectTappable(clear)
  await clear.click()
  const dialog = reopened.getByRole('alertdialog', { name: 'Clear this device?' })
  await expect(dialog).toContainText(
    'This deletes the Recordings and Toots on this device. The ones saved to your account stay there.'
  )
  for (const control of ['Cancel', 'Clear']) {
    await expectTappable(dialog.getByRole('button', { name: control, exact: true }))
  }
  await reopened.screenshot({ path: testInfo.outputPath('clear-this-device.png') })
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  expect(await stored(reopened, 'recordings')).toBe(1)
  await clear.click()
  await dialog.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(reopened.getByRole('button', { name: 'Save to an account' })).toBeVisible()
  expect(await stored(reopened, 'recordings')).toBe(0)
  expect(await accountOf(reopened)).toBeNull()
})

test("signing in to another account mid-visit asks nothing with nothing unsaved, and the first account's farts leave the screen", async ({
  page,
  context
}, testInfo) => {
  const second = newEmail(testInfo, 'second')
  const reopened = await expiredWithARecording(page, context, newEmail(testInfo, 'first'))
  const step = reopened.getByRole('dialog', { name: 'Sign in again' })
  await expect(step).toBeVisible()
  await expect(reopened.getByTestId('recording-row')).toHaveCount(1)

  await step.getByLabel('Email').fill(second)
  await step.getByRole('button', { name: 'Send code' }).click()
  const code = step.getByLabel('Code')
  await expect(code).toBeFocused()
  await expect(step.getByTestId('account-step-unsaved')).toHaveCount(0)
  await code.fill(await codeFor(reopened, second))
  await step.getByRole('button', { name: 'Sign in' }).click()

  await expect(step).toBeHidden()
  await expect(reopened).toHaveURL(/\/recordings\/$/)
  await expect(reopened.getByTestId('recording-row')).toHaveCount(0)
  await expect.poll(() => stored(reopened, 'recordings')).toBe(0)
  expect((await session(reopened))?.user.email).toBe(second)
})

test('signing in to another account says first how many farts here it removes, and Go back keeps them', async ({
  page,
  context
}, testInfo) => {
  const first = newEmail(testInfo, 'first')
  const second = newEmail(testInfo, 'second')
  const reopened = await expiredWithARecording(page, context, first)
  await reopened
    .getByRole('dialog', { name: 'Sign in again' })
    .getByRole('button', { name: 'Not now' })
    .click()
  await recordAndSave(reopened, 2)
  await reopened.getByRole('button', { name: 'Done' }).click()
  await expect(reopened.getByTestId('recording-row')).toHaveCount(2)
  expect(await stored(reopened, 'outbox')).toBe(1)

  await tab(reopened, 'Profile').click()
  await reopened.getByRole('button', { name: 'Sign in again' }).click()
  const step = reopened.getByRole('dialog', { name: 'Sign in again' })
  await step.getByLabel('Email').fill(second)
  await step.getByRole('button', { name: 'Send code' }).click()
  const warning = step.getByTestId('account-step-unsaved')
  await expect(warning.getByRole('alert')).toHaveText(
    "1 fart on this device hasn't saved to the other account. Signing in here removes it from this device."
  )
  const back = warning.getByRole('button', { name: 'Go back' })
  const anyway = warning.getByRole('button', { name: 'Sign in anyway' })
  await expect(back).toBeFocused()
  for (const control of [back, anyway]) await expectTappable(control)
  await reopened.screenshot({ path: testInfo.outputPath('unsaved-farts.png') })

  await back.click()
  await expect(warning).toHaveCount(0)
  await expect(step.getByLabel('Email')).toBeFocused()
  expect(await stored(reopened, 'recordings')).toBe(2)

  await step.getByLabel('Email').fill(first.toUpperCase())
  await step.getByRole('button', { name: 'Send code' }).click()
  await expect(step.getByLabel('Code')).toBeFocused()
  await step.getByRole('button', { name: 'Change email' }).click()

  await step.getByLabel('Email').fill(second)
  await step.getByRole('button', { name: 'Send code' }).click()
  await anyway.click()
  const code = step.getByLabel('Code')
  await expect(code).toBeFocused()
  await code.fill(await codeFor(reopened, second))
  await step.getByRole('button', { name: 'Sign in' }).click()
  await expect(step).toBeHidden()
  await expect(reopened.getByTestId('stat-recordings')).toHaveText('Recordings0')
  await expect.poll(() => stored(reopened, 'recordings')).toBe(0)
  expect((await session(reopened))?.user.email).toBe(second)
})
