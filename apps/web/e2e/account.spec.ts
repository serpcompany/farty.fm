import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { type BrowserContext, expect, type Locator, type Page, test } from '@playwright/test'
import { codeFor, newEmail, ownClient, session, signInByApi } from './account'
import { recordAndSave, skipWelcome, withFakeMicrophone } from './record'

// The account step and Profile's account (#155), and a guest's farts lasting only the visit
// (#150), at phone size. Sign-in codes come from the dev mailbox (`e2e/account.ts`).

const g3 = '090__carlosramon__17-pet__186119.wav'
withFakeMicrophone(g3)

test.skip(({ isMobile }) => !isMobile, 'The account step is checked at phone size')

test("a guest's first Result offers the account step, and Not now goes where they tapped", async ({
  page
}) => {
  await recordAndSave(page, 1.5, { offersAccount: true })
  await expect(page.getByTestId('result-note')).toHaveText('G3')
  await page.getByRole('button', { name: 'Done' }).click()

  const step = page.getByRole('dialog', { name: 'Keep your farts' })
  await expect(step).toBeVisible()
  // Focus moves into the step, so a screen reader says it opened.
  await expect(step.getByRole('heading', { name: 'Keep your farts' })).toBeFocused()
  await expect(step).toContainText(
    'Make a free account to keep your Recordings and Toots on any device.'
  )
  await expect(step.getByTestId('account-step-guest')).toHaveText(
    'Without an account, your farts are gone when you close Pedos.'
  )
  for (const control of [
    step.getByLabel('Email'),
    step.getByRole('button', { name: 'Send code' }),
    step.getByRole('link', { name: 'Privacy' }),
    step.getByRole('button', { name: 'Not now' })
  ]) {
    await expectTappable(control)
  }
  // Not until the step closes does Pedos go where the tap said.
  await expect(page).not.toHaveURL(/\/recordings\/$/)

  await step.getByRole('button', { name: 'Not now' }).click()
  await expect(step).toBeHidden()
  await expect(page).toHaveURL(/\/recordings\/$/)
  await expect(page.getByTestId('recording-row')).toHaveCount(1)
  // Offered once at a Result: it waits for the first saved Toot now.
  expect(await page.evaluate(() => localStorage.getItem('pedos.accountStep'))).toBe('once')
})

test('the step comes back once after the first saved Toot, then only from Profile', async ({
  page,
  request
}) => {
  test.setTimeout(180_000)
  test.skip(
    !(await request.get('/fixtures/recordings/index.json')).ok(),
    'Toots need the Fixture Library, which only the Staging build has (pnpm build:staging)'
  )
  // As after Not now on the first Result.
  await page.addInitScript(() => {
    localStorage.setItem('pedos.welcomed', '1')
    if (localStorage.getItem('pedos.accountStep') === null) {
      localStorage.setItem('pedos.accountStep', 'once')
    }
  })
  await page.goto('/profile/')
  const library = page.getByTestId('fixture-library')
  await library.getByRole('button', { name: 'Load the Fixture Library' }).click()
  await expect(library.getByRole('button', { name: 'Fixture Library loaded' })).toBeDisabled({
    timeout: 90_000
  })

  const step = page.getByRole('dialog', { name: 'Keep your farts' })
  await saveAToot(page, 'mary')
  await expect(step).toBeVisible()
  await step.getByRole('button', { name: 'Not now' }).click()
  await expect(step).toBeHidden()
  // The Toot was saved, and Song Creator is still there.
  await expect(page).toHaveURL(/\/compose\/mary\/$/)
  await expect(page.getByRole('button', { name: 'Saved to Toots' })).toBeDisabled()

  await saveAToot(page, 'twinkle')
  await expect(page.getByRole('button', { name: 'Saved to Toots' })).toBeDisabled()
  await expect(step).toHaveCount(0)

  // Profile's Save to an account opens it any time.
  await tab(page, 'Profile').click()
  await page.getByRole('button', { name: 'Save to an account' }).click()
  await expect(step).toBeVisible()
})

test('signing up from the first Result keeps the Recording, and goes where they tapped', async ({
  page
}, testInfo) => {
  test.setTimeout(120_000)
  const email = newEmail(testInfo, 'step')
  await ownClient(page.context())
  await page.addInitScript(() => {
    const asked = window as unknown as { keepAsked: boolean }
    asked.keepAsked = false
    navigator.storage.persist = async () => {
      asked.keepAsked = true
      return true
    }
  })

  await recordAndSave(page, 1.5, { offersAccount: true })
  await expect(page.getByTestId('result-note')).toHaveText('G3')
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
  // A wrong code says so, and the right one still works.
  const right = await codeFor(page, email)
  await code.fill(right === '000000' ? '111111' : '000000')
  await step.getByRole('button', { name: 'Sign in' }).click()
  await expect(step.getByRole('alert')).toHaveText("That code isn't right. Check it and try again.")
  await code.fill(right)
  await step.getByRole('button', { name: 'Sign in' }).click()

  // Signed in: on to Record, as Record another said, and the browser is asked to keep the farts.
  await expect(step).toBeHidden()
  await expect(page).toHaveURL(/:\d+\/$/)
  await expect(page.getByTestId('record-button')).toBeVisible()
  expect((await session(page))?.user.email).toBe(email)
  expect(await page.evaluate(() => (window as unknown as { keepAsked: boolean }).keepAsked)).toBe(
    true
  )

  // Closed and opened again, a signed-in user's Recording is still here.
  const context = page.context()
  await page.close()
  const reopened = await context.newPage()
  await reopened.goto('/recordings/')
  await expect(reopened.getByTestId('recording-row')).toHaveCount(1)
  // And the step never offers itself again.
  expect(await reopened.evaluate(() => localStorage.getItem('pedos.accountStep'))).toBe('done')
})

test("Profile's account: the email, Pedos news, and Sign out, which leaves nothing here", async ({
  page
}, testInfo) => {
  test.setTimeout(120_000)
  const email = newEmail(testInfo, 'profile')
  await recordAndSave(page, 1.5)
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByTestId('recording-row')).toHaveCount(1)
  await signInByApi(page, email)
  await page.goto('/profile/')

  await expect(page.getByTestId('account-email')).toHaveText(email)
  const news = page.getByRole('switch', { name: 'Pedos news' })
  // On by default (#150).
  await expect(news).toBeChecked()
  for (const control of [
    page.locator('label', { has: news }),
    page.getByRole('button', { name: 'Sign out' }),
    page.getByRole('button', { name: 'Delete account' })
  ]) {
    await expectTappable(control)
  }
  // The whole row turns it off, and the account keeps it.
  await page.locator('label', { has: news }).click()
  await expect(news).not.toBeChecked()
  await page.reload()
  await expect(news).not.toBeChecked()
  expect((await session(page))?.user).toMatchObject({ email, marketingEmail: false })
  await news.click()
  await expect(news).toBeChecked()

  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('button', { name: 'Save to an account' })).toBeVisible()
  await expect(page).toHaveURL(/\/profile\/$/)
  await expect(page.getByTestId('stat-recordings')).toHaveText('Recordings0')
  expect(await session(page)).toBeNull()
  expect(await recordingsStored(page)).toBe(0)
  // A guest's browser again: the next visit clears what a guest saves.
  expect(await page.evaluate(() => localStorage.getItem('pedos.account'))).toBeNull()
})

test('Delete account asks first, then deletes the account and leaves nothing here', async ({
  page
}, testInfo) => {
  test.setTimeout(120_000)
  const email = newEmail(testInfo, 'delete')
  await recordAndSave(page, 1.5)
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByTestId('recording-row')).toHaveCount(1)
  await signInByApi(page, email)
  await page.goto('/profile/')

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
  await expect(page.getByRole('button', { name: 'Save to an account' })).toBeVisible()
  await expect(page).toHaveURL(/\/profile\/$/)
  await expect(page.getByTestId('stat-recordings')).toHaveText('Recordings0')
  expect(await session(page)).toBeNull()
  expect(await recordingsStored(page)).toBe(0)
  expect(await page.evaluate(async () => (await fetch('/api/library/')).status)).toBe(401)
})

test("Profile's Save to an account opens the step, which stays while they read their email", async ({
  page
}) => {
  await page.addInitScript(skipWelcome)
  await page.goto('/profile/')
  const save = page.getByRole('button', { name: 'Save to an account' })
  await expectTappable(save)
  await expect(
    page.getByText('Without an account, your farts are gone when you close Pedos.')
  ).toBeVisible()
  await save.click()
  const step = page.getByRole('dialog', { name: 'Keep your farts' })
  await expect(step).toBeVisible()
  await step.getByLabel('Email').fill('later@example.com')

  // Off to Mail and back: a hidden page comes back on Record, but not with the step open.
  await setVisibility(page, 'hidden')
  await setVisibility(page, 'visible')
  await expect(step).toBeVisible()
  await expect(page).toHaveURL(/\/profile\/$/)
  await step.getByRole('button', { name: 'Not now' }).click()
  await expect(step).toBeHidden()
  await expect(page).toHaveURL(/\/profile\/$/)
  // Focus goes back to the button that opened it.
  await expect(save).toBeFocused()

  // Not now drops the half-typed email, so a reload doesn't bring the step back.
  await page.reload()
  // Profile shows the button once the session is read, in the same update that would reopen it.
  await expect(save).toBeVisible()
  await expect(step).toBeHidden()
})

test("a guest's Recording lasts the visit: through a reload and another tab, then it's gone", async ({
  page,
  context
}) => {
  await context.addInitScript(skipWelcome)
  await recordAndSave(page, 1.5)
  await page.getByRole('button', { name: 'Done' }).click()
  const rows = (on: Page) => on.getByTestId('recording-row')
  await expect(rows(page)).toHaveCount(1)

  await page.reload()
  await expect(rows(page)).toHaveCount(1)
  // A second tab, while this one is open, is the same visit.
  const second = await context.newPage()
  await second.goto('/recordings/')
  await expect(rows(second)).toHaveCount(1)
  await second.close()

  // Pedos closes, and opens again.
  const reopened = await reopen(context, page)
  await expect(reopened.getByText('No Recordings yet')).toBeVisible()
  expect(await recordingsStored(reopened)).toBe(0)
})

test('farts saved before guests kept nothing last this visit, then go', async ({
  page,
  context
}) => {
  await context.addInitScript(skipWelcome)
  // A browser that used Pedos before: a Recording, saved by the app's own database.
  await page.goto('/robots.txt')
  const wav = readFileSync(resolve(__dirname, '../../../fixtures/recordings', g3))
  await page.evaluate(async base64 => {
    const audio = Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('pedos', 2)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('recordings', { keyPath: 'id' })
        request.result.createObjectStore('audio')
        request.result.createObjectStore('toots', { keyPath: 'id' })
        request.result.createObjectStore('tootAudio')
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = db.transaction(['recordings', 'audio'], 'readwrite')
    transaction.objectStore('recordings').put({
      id: 'from-before',
      number: 1,
      createdAt: Date.now(),
      seconds: 1,
      sampleRate: 44100,
      waveform: [],
      analysis: { state: 'notAnalyzed' }
    })
    transaction.objectStore('audio').put(audio, 'from-before')
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
    })
    db.close()
  }, wav.toString('base64'))

  await page.goto('/recordings/')
  await expect(page.getByTestId('recording-row')).toHaveCount(1)
  const reopened = await reopen(context, page)
  await expect(reopened.getByText('No Recordings yet')).toBeVisible()
})

test("a Recording saved while Pedos still reads the session isn't cleared with the last visit's", async ({
  page,
  context
}) => {
  // A guest's second visit, so opening clears the first's.
  await context.addInitScript(skipWelcome)
  await page.goto('/recordings/')
  await expect(page.getByText('No Recordings yet')).toBeVisible()
  await page.close()
  const visit = await context.newPage()

  // The session answers only when the test says, within the 5 seconds Pedos waits for it.
  let answer = () => {}
  const answered = new Promise<void>(resolve => (answer = resolve))
  await visit.route('**/api/auth/get-session*', async route => {
    await answered
    await route.continue()
  })
  await recordAndSave(visit, 1)
  // The take waits for the visit to start: nothing is saved until the session is read.
  await visit.waitForTimeout(300)
  expect(await recordingsStored(visit)).toBe(0)
  answer()
  await expect(visit.getByTestId('result-note')).toHaveText('G3')
  expect(await recordingsStored(visit)).toBe(1)
})

test("an account's farts stay when its session ends, and Pedos asks to sign in again", async ({
  page,
  context
}, testInfo) => {
  test.setTimeout(120_000)
  const email = newEmail(testInfo, 'expired')
  // A guest's first open, then sign-in: the next visit would clear a guest's farts.
  await recordAndSave(page, 1.5)
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByTestId('recording-row')).toHaveCount(1)
  await signInByApi(page, email)
  await page.reload()
  await expect(page.getByTestId('recording-row')).toHaveCount(1)

  // The session ends (7 days without an open, or the cookie goes), and Pedos opens again.
  await context.clearCookies()
  const reopened = await reopen(context, page)
  const step = reopened.getByRole('dialog', { name: 'Sign in again' })
  await expect(step).toBeVisible()
  await expect(step).toContainText('Your farts stay on this device until you sign in.')
  await expect(step.getByTestId('account-step-guest')).toHaveCount(0)
  await step.getByRole('button', { name: 'Not now' }).click()
  await expect(reopened.getByTestId('recording-row')).toHaveCount(1)
  expect(await recordingsStored(reopened)).toBe(1)

  // Asked once a visit; Profile asks too.
  await reopened.goto('/profile/')
  const again = reopened.getByRole('button', { name: 'Sign in again' })
  await expectTappable(again)
  await expect(step).toBeHidden()
})

test("Profile retries an account it couldn't reach, and reads it again back online", async ({
  page
}) => {
  await page.addInitScript(skipWelcome)
  await page.route('**/api/auth/get-session*', route => route.abort('internetdisconnected'))
  await page.goto('/profile/')
  await expect(page.getByText("Can't reach your account right now.")).toBeVisible()
  const retry = page.getByRole('button', { name: 'Retry' })
  await expectTappable(retry)

  await page.unrouteAll()
  await retry.click()
  const save = page.getByRole('button', { name: 'Save to an account' })
  await expect(save).toBeVisible()

  await page.route('**/api/auth/get-session*', route => route.abort('internetdisconnected'))
  await page.reload()
  await expect(retry).toBeVisible()
  await page.unrouteAll()
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(save).toBeVisible()
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

  // The phone drops the tab while Mail is open; coming back reloads Pedos.
  await page.reload()
  await expect(step).toContainText(`We sent a 6-digit code to ${email}.`)
  await expect(step.getByLabel('Code')).toBeFocused()
  await step.getByLabel('Code').fill(await codeFor(page, email))
  await step.getByRole('button', { name: 'Sign in' }).click()
  await expect(step).toBeHidden()
  await expect(page.getByTestId('account-email')).toHaveText(email)
  // Closed, the step stays closed through the next reload.
  await page.reload()
  await expect(page.getByTestId('account-email')).toHaveText(email)
  await expect(step).toBeHidden()
})

/** Closes Pedos's last tab, and opens Pedos again on Recordings. */
async function reopen(context: BrowserContext, page: Page): Promise<Page> {
  await page.close()
  const reopened = await context.newPage()
  await reopened.goto('/recordings/')
  return reopened
}

/** Opens a Song from Compose, waits for its Toot, and saves it. */
async function saveAToot(page: Page, songId: string) {
  await tab(page, 'Compose').click()
  await page
    .getByTestId('unlocked-songs')
    .locator(`[data-song="${songId}"]`)
    .getByRole('link')
    .click({ timeout: 60_000 })
  await expect(page).toHaveURL(new RegExp(`/compose/${songId}/$`))
  await page.getByRole('button', { name: 'Save to Toots' }).click({ timeout: 60_000 })
}

function tab(page: Page, label: string) {
  return page
    .getByRole('navigation', { name: 'Tabs' })
    .getByRole('link', { name: label, exact: true })
}

/** How many Recordings the `pedos` database holds. */
function recordingsStored(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('pedos')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const count = await new Promise<number>((resolve, reject) => {
      if (!db.objectStoreNames.contains('recordings')) return resolve(0)
      const request = db.transaction('recordings').objectStore('recordings').count()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return count
  })
}

/** Fakes the page going to the background (`hidden`) and coming back (`visible`). */
async function setVisibility(page: Page, state: 'hidden' | 'visible'): Promise<void> {
  await page.evaluate(state => {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  }, state)
}

/** A control a thumb can hit: at least 44 by 44 CSS pixels, as the iPhone's controls. */
async function expectTappable(control: Locator) {
  // Once a dialog has finished zooming in.
  await expect(async () => {
    const box = await control.boundingBox()
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  }).toPass({ timeout: 2_000 })
}
