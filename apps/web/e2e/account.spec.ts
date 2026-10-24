import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { type BrowserContext, expect, type Locator, type Page, test } from '@playwright/test'
import { codeFor, newEmail, ownClient, session, signInByApi } from './account'
import { recordAndSave, skipWelcome, withFakeMicrophone } from './record'
import { onPhone } from './screens'

// The account step and Profile's account (#155), and what a guest keeps: their Recordings,
// while their Toots last only the visit (#150, #203), at phone size. Sign-in codes come from
// the dev mailbox (`e2e/account.ts`).

const g3 = '090__carlosramon__17-pet__186119.wav'
withFakeMicrophone(g3)

test.skip(({ viewport }) => !onPhone({ viewport }), 'The account step is checked at phone size')

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
    'Make a free account to keep your Recordings and Toots, even on a new phone.'
  )
  await expect(step.getByTestId('account-step-guest')).toHaveText(
    'Without an account, your Recordings stay only in this browser, and your Toots are gone when you close Farty.'
  )
  for (const control of [
    step.getByLabel('Email'),
    step.getByRole('button', { name: 'Send code' }),
    step.getByRole('link', { name: 'Privacy' }),
    step.getByRole('button', { name: 'Not now' })
  ]) {
    await expectTappable(control)
  }
  // Not until the step closes does Farty go where the tap said.
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

test("Profile's account: the email, Farty news, and Sign out, which leaves nothing here", async ({
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
  const news = page.getByRole('switch', { name: 'Farty news' })
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
  // A guest's browser again, with nothing of the account's.
  expect(await page.evaluate(() => localStorage.getItem('pedos.account'))).toBeNull()
})

test("Sign out uploads the farts not uploaded yet, and while it can't, Wait keeps the account", async ({
  page
}, testInfo) => {
  test.setTimeout(120_000)
  const email = newEmail(testInfo, 'pending')
  await page.addInitScript(skipWelcome)
  await page.goto('/profile/')
  await signInByApi(page, email)
  // Offline for uploads: the Recording stays in the outbox.
  await page.route('**/api/recordings/**', route => route.abort('internetdisconnected'))
  await recordAndSave(page, 1.5)
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByTestId('recording-row')).toHaveCount(1)

  await tab(page, 'Profile').click()
  await page.getByRole('button', { name: 'Sign out' }).click()
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
  expect(await recordingsStored(page)).toBe(1)

  // Back online, Sign out uploads it, then signs out and leaves nothing here.
  await page.unrouteAll()
  const sent: string[] = []
  page.on('request', request => sent.push(`${request.method()} ${new URL(request.url()).pathname}`))
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('button', { name: 'Save to an account' })).toBeVisible()
  expect(await recordingsStored(page)).toBe(0)
  const upload = sent.findIndex(line => /^PUT \/api\/recordings\/[\w-]+\/$/.test(line))
  expect(upload).toBeGreaterThanOrEqual(0)
  expect(upload).toBeLessThan(sent.indexOf('POST /api/auth/sign-out'))

  // It's in the account: signed in again, the Recording comes back.
  await signInByApi(page, email)
  await page.goto('/recordings/')
  await expect(page.getByTestId('recording-row')).toHaveCount(1)
  await expect(page.getByRole('button', { name: /^Recording 1, \d+\.\d s, G3$/ })).toBeVisible()
})

test('Sign out anyway signs out and leaves behind the farts not uploaded', async ({
  page
}, testInfo) => {
  test.setTimeout(120_000)
  const email = newEmail(testInfo, 'anyway')
  await page.addInitScript(skipWelcome)
  await page.goto('/profile/')
  await signInByApi(page, email)
  await page.route('**/api/recordings/**', route => route.abort('internetdisconnected'))
  await recordAndSave(page, 1.5)
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByTestId('recording-row')).toHaveCount(1)

  await tab(page, 'Profile').click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await page
    .getByRole('alertdialog', { name: 'Not uploaded yet' })
    .getByRole('button', { name: 'Sign out anyway' })
    .click()
  await expect(page.getByRole('button', { name: 'Save to an account' })).toBeVisible()
  expect(await session(page)).toBeNull()
  expect(await recordingsStored(page)).toBe(0)

  // Signed in again, the account never had it.
  await page.unrouteAll()
  await signInByApi(page, email)
  await page.goto('/recordings/')
  await expect(page.getByText('No Recordings yet')).toBeVisible()
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

test('Profile left open on one account never changes or deletes the account another tab signed in to', async ({
  page,
  context
}, testInfo) => {
  test.setTimeout(150_000)
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

  // Farty news, from the page still showing the first account: nothing changes, and the page
  // reloads as the account signed in now.
  await signInElsewhere(second)
  await page.getByRole('switch', { name: 'Farty news' }).click()
  await expect(page.getByTestId('account-email')).toHaveText(second)
  await expect(page.getByRole('switch', { name: 'Farty news' })).toBeChecked()
  expect((await session(page))?.user.marketingEmail).not.toBe(false)

  // Delete account, from the page now showing the second: the first account, signed in now, and
  // its session stay.
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

test("Profile's Save to an account opens the step, which stays while they read their email", async ({
  page
}) => {
  await page.addInitScript(skipWelcome)
  await page.goto('/profile/')
  const save = page.getByRole('button', { name: 'Save to an account' })
  await expectTappable(save)
  await expect(
    page.getByText(
      'Without an account, your Recordings stay only in this browser, and your Toots are gone when you close Farty.'
    )
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

test("a guest's Recording outlasts closing Farty and still plays, while their Toot lasts the visit", async ({
  page,
  context
}) => {
  await context.addInitScript(skipWelcome)
  await context.addInitScript(askedToKeep)
  await recordAndSave(page, 1.5)
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByTestId('recording-row')).toHaveCount(1)
  // With the first Recording, Farty asks the browser to keep its storage.
  await expect.poll(() => keepAsked(page)).toBe(true)
  await saveATootHere(page)

  // A reload, and a second tab while this one is open, are the same visit.
  await page.reload()
  await expect(page.getByTestId('toot-row')).toHaveCount(1)
  const second = await context.newPage()
  await second.goto('/toots/')
  await expect(second.getByTestId('toot-row')).toHaveCount(1)
  await second.close()

  // Farty closes, and opens again: the Recording is there and plays, and the Toot is gone.
  const reopened = await reopen(context, page)
  await expectARecordingThatPlays(reopened)
  expect(await recordingsStored(reopened, 'toots')).toBe(0)
  expect(await recordingsStored(reopened, 'tootAudio')).toBe(0)
  // What's left for a sign-in to send is the Recording's upload.
  expect(await recordingsStored(reopened, 'outbox')).toBe(1)
  await tab(reopened, 'Toots').click()
  await expect(reopened.getByText('Nothing yet')).toBeVisible()

  // And again, closed and opened.
  await expectARecordingThatPlays(await reopen(context, reopened))
})

test("a guest's Recording is there when the installed app opens again offline", async ({
  page,
  context
}) => {
  test.skip(
    process.env.E2E_SERVER !== 'preview' && !process.env.E2E_BASE_URL,
    'Only a build registers the service worker'
  )
  await context.addInitScript(skipWelcome)
  await recordAndSave(page, 1.5)
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByTestId('recording-row')).toHaveCount(1)
  await page.waitForFunction(async () => {
    await navigator.serviceWorker.ready
    return navigator.serviceWorker.controller !== null
  })

  // Opened again online, as a guest's new visit, then offline from the service worker.
  const online = await reopen(context, page)
  await expectARecordingThatPlays(online)
  await context.setOffline(true)
  const offline = await reopen(context, online)
  await expectARecordingThatPlays(offline)
  await context.setOffline(false)
})

test("a browser's farts from before a guest's Toots lasted the visit: the Recording stays, the Toot goes after this visit", async ({
  page,
  context
}) => {
  await context.addInitScript(skipWelcome)
  // A browser that used Farty before: a Recording and a Toot, saved by the app's own database.
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
    const transaction = db.transaction(['recordings', 'audio', 'toots', 'tootAudio'], 'readwrite')
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
    transaction.objectStore('toots').put({
      id: 'toot-from-before',
      title: 'From before',
      songId: 'mary',
      createdAt: Date.now(),
      seconds: 1,
      arrangement: { transposition: 0, recordingForPitch: {} }
    })
    transaction.objectStore('tootAudio').put(audio, 'toot-from-before')
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
    })
    db.close()
  }, wav.toString('base64'))

  await page.goto('/toots/')
  await expect(page.getByTestId('toot-row')).toHaveCount(1)
  const reopened = await reopen(context, page)
  await expect(reopened.getByTestId('recording-row')).toHaveCount(1)
  expect(await recordingsStored(reopened, 'toots')).toBe(0)
  await tab(reopened, 'Toots').click()
  await expect(reopened.getByText('Nothing yet')).toBeVisible()
})

test('a Recording saved while Farty still reads the session waits for the visit to start', async ({
  page,
  context
}) => {
  // A guest's second visit, on a library an account left before #203, which its open clears whole.
  await context.addInitScript(skipWelcome)
  await page.goto('/recordings/')
  await expect(page.getByText('No Recordings yet')).toBeVisible()
  // It has read the account's changes.
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('pedos')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = db.transaction('meta', 'readwrite')
    transaction.objectStore('meta').put(1, 'cursor')
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
    })
    db.close()
  })
  await page.close()
  const visit = await context.newPage()

  // The session answers only when the test says, within the 5 seconds Farty waits for it.
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
  expect(await recordingsStored(visit, 'meta')).toBe(0)
})

test("an account's farts stay when its session ends: Farty asks to sign in again, or clears them", async ({
  page,
  context
}, testInfo) => {
  test.setTimeout(120_000)
  const email = newEmail(testInfo, 'expired')
  // A guest's first open, then sign-in: the next visit would clear a guest's Toots.
  await recordAndSave(page, 1.5)
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByTestId('recording-row')).toHaveCount(1)
  await signInByApi(page, email)
  await page.reload()
  await expect(page.getByTestId('recording-row')).toHaveCount(1)

  // The session ends (7 days without an open, or the cookie goes), and Farty opens again.
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

  // Not their device any more: Clear asks first, then leaves nothing here.
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
  expect(await recordingsStored(reopened)).toBe(1)
  await clear.click()
  await dialog.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(reopened.getByRole('button', { name: 'Save to an account' })).toBeVisible()
  expect(await recordingsStored(reopened)).toBe(0)
  expect(await reopened.evaluate(() => localStorage.getItem('pedos.account'))).toBeNull()
})

test("signing in to another account mid-visit asks nothing with nothing unsaved, and the first account's farts leave the screen", async ({
  page,
  context
}, testInfo) => {
  test.setTimeout(120_000)
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

  // Without a reload, the first account's Recording leaves the screen and this device.
  await expect(step).toBeHidden()
  await expect(reopened).toHaveURL(/\/recordings\/$/)
  await expect(reopened.getByTestId('recording-row')).toHaveCount(0)
  await expect.poll(() => recordingsStored(reopened)).toBe(0)
  expect((await session(reopened))?.user.email).toBe(second)
})

test('signing in to another account says first how many farts here it removes, and Go back keeps them', async ({
  page,
  context
}, testInfo) => {
  test.setTimeout(150_000)
  const first = newEmail(testInfo, 'first')
  const second = newEmail(testInfo, 'second')
  const reopened = await expiredWithARecording(page, context, first)
  await reopened
    .getByRole('dialog', { name: 'Sign in again' })
    .getByRole('button', { name: 'Not now' })
    .click()
  // Made while the session has ended: it stays on this device until a sign-in.
  await recordAndSave(reopened, 1.5)
  await reopened.getByRole('button', { name: 'Done' }).click()
  await expect(reopened.getByTestId('recording-row')).toHaveCount(2)
  expect(await recordingsStored(reopened, 'outbox')).toBe(1)

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
  // The warning replaces the form, so focus moves to Go back rather than falling to the page.
  await expect(back).toBeFocused()
  for (const control of [back, anyway]) await expectTappable(control)
  await reopened.screenshot({ path: testInfo.outputPath('unsaved-farts.png') })

  // Go back: the email again, and nothing removed.
  await back.click()
  await expect(warning).toHaveCount(0)
  await expect(step.getByLabel('Email')).toBeFocused()
  expect(await recordingsStored(reopened)).toBe(2)

  // The account they came from, however it's typed, asks nothing.
  await step.getByLabel('Email').fill(first.toUpperCase())
  await step.getByRole('button', { name: 'Send code' }).click()
  await expect(step.getByLabel('Code')).toBeFocused()
  await step.getByRole('button', { name: 'Change email' }).click()

  // Sign in anyway: the other account, and this device's farts go.
  await step.getByLabel('Email').fill(second)
  await step.getByRole('button', { name: 'Send code' }).click()
  await anyway.click()
  const code = step.getByLabel('Code')
  await expect(code).toBeFocused()
  await code.fill(await codeFor(reopened, second))
  await step.getByRole('button', { name: 'Sign in' }).click()
  await expect(step).toBeHidden()
  await expect(reopened.getByTestId('stat-recordings')).toHaveText('Recordings0')
  await expect.poll(() => recordingsStored(reopened)).toBe(0)
  expect((await session(reopened))?.user.email).toBe(second)
})

test("Sign out clears Farty's other tabs too, without a reload", async ({
  page,
  context
}, testInfo) => {
  test.setTimeout(120_000)
  await page.addInitScript(skipWelcome)
  await page.goto('/profile/')
  await signInByApi(page, newEmail(testInfo, 'tabs'))
  await recordAndSave(page, 1.5)
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByTestId('recording-row')).toHaveCount(1)
  const other = await context.newPage()
  await other.goto('/recordings/')
  await expect(other.getByTestId('recording-row')).toHaveCount(1)

  await tab(page, 'Profile').click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('button', { name: 'Save to an account' })).toBeVisible()
  await expect(other.getByTestId('recording-row')).toHaveCount(0)
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

  // The phone drops the tab while Mail is open; coming back reloads Farty.
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

/** Closes Farty's last tab, and opens Farty again on Recordings. */
async function reopen(context: BrowserContext, page: Page): Promise<Page> {
  await page.close()
  const reopened = await context.newPage()
  await reopened.goto('/recordings/')
  return reopened
}

/** An init script: stands in for the browser's ask to keep Farty's storage, and notes it. */
function askedToKeep(): void {
  const asked = window as unknown as { keepAsked: boolean }
  asked.keepAsked = false
  navigator.storage.persisted = async () => false
  navigator.storage.persist = async () => {
    asked.keepAsked = true
    return true
  }
}

function keepAsked(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as unknown as { keepAsked: boolean }).keepAsked)
}

/**
 * Saves a Toot in the app's own database as Song Creator does, with the upload it queues, and
 * opens the Toots tab, where it shows. Song Creator needs a Song unlocked, which needs the Fixture
 * Library, which only the Staging build has.
 */
async function saveATootHere(page: Page) {
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('pedos')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const id = crypto.randomUUID()
    const transaction = db.transaction(['toots', 'tootAudio', 'outbox'], 'readwrite')
    transaction.objectStore('toots').put({
      id,
      title: 'Mary Had a Little Lamb',
      songId: 'mary',
      createdAt: Date.now(),
      seconds: 1,
      arrangement: { transposition: 0, recordingForPitch: {} }
    })
    transaction.objectStore('tootAudio').put(new ArrayBuffer(44), id)
    transaction.objectStore('outbox').put({
      key: `toots:${id}`,
      kind: 'toots',
      id,
      op: 'put',
      sent: false,
      queuedAt: Date.now(),
      version: crypto.randomUUID()
    })
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
    })
    db.close()
  })
  // In the same tab, so the same visit, and it reads the Toot.
  await page.goto('/toots/')
  await expect(page.getByTestId('toot-row')).toHaveCount(1)
}

/** The guest's G3 Recording is on Recordings, with its note, and plays from its WAV. */
async function expectARecordingThatPlays(page: Page) {
  await expect(page.getByTestId('recording-row')).toHaveCount(1)
  const row = page.getByRole('button', { name: /^Recording 1, \d+\.\d s, G3$/ })
  await row.click()
  await expect(row).toHaveAttribute('aria-pressed', 'true')
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

/** How many Recordings (or what `store` holds) the `pedos` database holds. */
function recordingsStored(page: Page, store = 'recordings'): Promise<number> {
  return page.evaluate(async store => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('pedos')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const count = await new Promise<number>((resolve, reject) => {
      if (!db.objectStoreNames.contains(store)) return resolve(0)
      const request = db.transaction(store).objectStore(store).count()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return count
  }, store)
}

/** Waits until everything this browser changed is in the account: its outbox is empty. */
async function uploaded(page: Page) {
  await expect.poll(() => recordingsStored(page, 'outbox'), { timeout: 30_000 }).toBe(0)
}

/**
 * Signs in to an account, records a fart that uploads, then ends the session and opens Farty
 * again on Recordings, where the step asks to sign in again.
 */
async function expiredWithARecording(page: Page, context: BrowserContext, email: string) {
  await page.addInitScript(skipWelcome)
  await page.goto('/profile/')
  await signInByApi(page, email)
  await recordAndSave(page, 1.5)
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByTestId('recording-row')).toHaveCount(1)
  await uploaded(page)
  await context.clearCookies()
  return reopen(context, page)
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
