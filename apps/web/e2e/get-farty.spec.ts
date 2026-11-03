import { randomInt } from 'node:crypto'
import { type Browser, type BrowserContextOptions, expect, type Page, test } from '@playwright/test'
import { codeFor, newEmail, ownClient, signInByApi } from './account'
import { skipWelcome } from './record'
import { onPhone } from './screens'

// Get Farty from a shared page (#318): someone signed out opens Maya's link on a phone and taps
// Get Farty. The first step makes a free account with "Add @maya as a friend" ticked, so the
// request is made before they leave the browser, after they pick a Handle; the second is the Home
// Screen steps. Unticked, no request goes. Signed out, a profile page's Add friend is the same
// flow, checked at phone and tablet size. A computer gets the QR code (desktop.spec.ts).

// A service worker would answer navigations itself, without the Staging gate's credentials.
test.use({ serviceWorkers: 'block' })

/** Claims `handle` for the signed-in account, as the first share does. */
async function claimHandle(page: Page, handle: string) {
  const status = await page.evaluate(
    async handle =>
      (
        await fetch('/api/handle/', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ handle })
        })
      ).status,
    handle
  )
  expect(status).toBe(201)
}

/**
 * Uploads a short silent Recording to the signed-in account and shares it, as the Recordings tab's
 * Share does. Answers its link's path.
 */
async function shareARecording(page: Page): Promise<string> {
  const url = await page.evaluate(async () => {
    const id = crypto.randomUUID()
    const sampleRate = 48_000
    const frames = 4_800
    // A 16-bit mono WAV of silence.
    const wav = new DataView(new ArrayBuffer(44 + frames * 2))
    const text = (at: number, value: string) => {
      for (let i = 0; i < value.length; i++) wav.setUint8(at + i, value.charCodeAt(i))
    }
    text(0, 'RIFF')
    wav.setUint32(4, 36 + frames * 2, true)
    text(8, 'WAVE')
    text(12, 'fmt ')
    wav.setUint32(16, 16, true)
    wav.setUint16(20, 1, true)
    wav.setUint16(22, 1, true)
    wav.setUint32(24, sampleRate, true)
    wav.setUint32(28, sampleRate * 2, true)
    wav.setUint16(32, 2, true)
    wav.setUint16(34, 16, true)
    text(36, 'data')
    wav.setUint32(40, frames * 2, true)
    const metadata = {
      id,
      number: 1,
      createdAt: Date.now(),
      seconds: frames / sampleRate,
      sampleRate,
      waveform: [0, 0.5, 1],
      analysis: {
        state: 'analyzed',
        analysis: {
          gestureStartSeconds: 0.01,
          gestureEndSeconds: 0.09,
          cutAtReattack: false,
          pitchEstimateMidi: 52,
          pitchConfidence: 0.8,
          recordingPitchMidi: 52.3,
          shortestNoteSeconds: 0.05
        }
      }
    }
    const form = new FormData()
    form.set('metadata', JSON.stringify(metadata))
    form.set('audio', new Blob([wav.buffer], { type: 'audio/wav' }), 'a.wav')
    const uploaded = await fetch(`/api/recordings/${id}/`, { method: 'PUT', body: form })
    if (!uploaded.ok) throw new Error(`upload answered ${uploaded.status}`)
    const shared = await fetch(`/api/share/recordings/${id}/`, { method: 'PUT' })
    if (shared.status !== 201) throw new Error(`share answered ${shared.status}`)
    return ((await shared.json()) as { url: string }).url
  })
  return new URL(url).pathname
}

/** Who has asked the signed-in user to be friends, by Handle. */
async function requestsTo(page: Page): Promise<string[]> {
  return page.evaluate(
    async () => ((await (await fetch('/api/friends/')).json()) as { requests: string[] }).requests
  )
}

/** A signed-out phone browser of its own, as someone the link was sent to. */
async function stranger(browser: Browser, options: BrowserContextOptions): Promise<Page> {
  const context = await browser.newContext({ ...options, serviceWorkers: 'block' })
  await ownClient(context)
  return context.newPage()
}

/** Makes the free account in the step, as a person reads their code in Mail. */
async function signUpInTheStep(page: Page, email: string) {
  const step = page.getByRole('dialog', { name: 'Make a free account' })
  await step.getByLabel('Email').fill(email)
  await step.getByRole('button', { name: 'Send code' }).click()
  await step.getByLabel('Code').fill(await codeFor(page, email))
  await step.getByRole('button', { name: 'Sign in' }).click()
  await expect(step).toBeHidden()
}

test('Get Farty on a shared page makes an account, asks the sharer to be friends, then shows the Home Screen steps', async ({
  page,
  browser,
  baseURL,
  httpCredentials,
  viewport,
  userAgent,
  deviceScaleFactor,
  isMobile,
  hasTouch
}, testInfo) => {
  test.skip(!onPhone({ viewport }), "Get Farty's two steps are checked at phone size")
  test.setTimeout(150_000)
  const maya = `e2e_${randomInt(1e9)}`
  const sam = `e2e_${randomInt(1e9)}`
  const phone = {
    baseURL,
    httpCredentials,
    viewport,
    userAgent,
    deviceScaleFactor,
    isMobile,
    hasTouch
  }

  const link = await test.step('maya shares a Recording', async () => {
    await page.addInitScript(skipWelcome, {})
    await page.goto('/profile/')
    await signInByApi(page, newEmail(testInfo, 'maya'))
    await claimHandle(page, maya)
    return shareARecording(page)
  })

  const samPage = await stranger(browser, phone)

  await test.step('signed out, Get Farty opens the account step, offering maya, ticked', async () => {
    await samPage.goto(link)
    await expect(samPage.getByText(`@${maya} shared a Recording`)).toBeVisible()
    // In the top bar, and under the player.
    await expect(samPage.getByRole('button', { name: 'Get Farty' })).toHaveCount(2)
    await samPage.getByRole('button', { name: 'Get Farty' }).last().click()

    const step = samPage.getByRole('dialog', { name: 'Make a free account' })
    await expect(step).toBeVisible()
    await expect(step).toContainText('It keeps your farts. Then add Farty to your Home Screen.')
    const offer = step.getByRole('checkbox', { name: `Add @${maya} as a friend` })
    await expect(offer).toBeChecked()
    const label = await step.getByText(`Add @${maya} as a friend`).boundingBox()
    expect(label?.height).toBeGreaterThanOrEqual(44)
    await testInfo.attach('account step', {
      body: await samPage.screenshot(),
      contentType: 'image/png'
    })
  })

  await test.step('sam signs up and picks a Handle, and the request goes', async () => {
    await signUpInTheStep(samPage, newEmail(testInfo, 'sam'))
    const dialog = samPage.getByRole('alertdialog')
    await expect(dialog.getByRole('heading', { name: 'Pick a handle' })).toBeVisible()
    await dialog.getByRole('textbox', { name: 'Handle' }).fill(sam)
    await expect(dialog.getByText(`@${sam} is free`)).toBeVisible()
    await dialog.getByRole('button', { name: 'Add friend' }).click()
    await expect(dialog).toBeHidden()

    const home = samPage.getByRole('dialog', { name: 'Get the app' })
    await expect(home).toBeVisible()
    await expect(home).toContainText(`You asked @${maya} to be friends.`)
    await expect(home.getByTestId('install-guide')).toBeVisible()
    await expect(home.getByRole('heading', { name: 'Get the app' })).toBeFocused()
    await testInfo.attach('Home Screen step', {
      body: await samPage.screenshot(),
      contentType: 'image/png'
    })

    // The request is on the server, from sam's new account to maya.
    expect(await requestsTo(page)).toEqual([sam])

    await home.getByRole('button', { name: 'Done' }).click()
    await expect(home).toBeHidden()
    await expect(samPage.getByRole('link', { name: 'Open Farty' })).toBeVisible()
  })

  await test.step('someone who unticks it signs up and asks no one', async () => {
    const leePage = await stranger(browser, phone)
    await leePage.goto(link)
    await leePage.getByRole('button', { name: 'Get Farty' }).first().click()
    const offer = leePage.getByRole('checkbox', { name: `Add @${maya} as a friend` })
    await offer.uncheck()
    await expect(offer).not.toBeChecked()

    await signUpInTheStep(leePage, newEmail(testInfo, 'lee'))
    const home = leePage.getByRole('dialog', { name: 'Get the app' })
    await expect(home).toBeVisible()
    await expect(home).not.toContainText(`@${maya}`)
    // No Handle was asked for, since no request goes.
    await expect(leePage.getByRole('alertdialog')).toHaveCount(0)
    expect(await requestsTo(page)).toEqual([sam])
    await leePage.context().close()
  })

  await samPage.context().close()
})

test("signed out, a profile page's Add friend is Get Farty, and the request reaches the server", async ({
  page,
  browser,
  baseURL,
  httpCredentials,
  viewport,
  userAgent,
  deviceScaleFactor,
  isMobile,
  hasTouch
}, testInfo) => {
  test.setTimeout(120_000)
  const maya = `e2e_${randomInt(1e9)}`
  const sam = `e2e_${randomInt(1e9)}`

  await test.step('maya has an account and a Handle', async () => {
    await page.addInitScript(skipWelcome, {})
    await page.goto('/profile/')
    await signInByApi(page, newEmail(testInfo, 'maya'))
    await claimHandle(page, maya)
  })

  const samPage = await stranger(browser, {
    baseURL,
    httpCredentials,
    viewport,
    userAgent,
    deviceScaleFactor,
    isMobile,
    hasTouch
  })

  await test.step("Add friend on maya's page opens the account step, offering maya, ticked", async () => {
    await samPage.goto(`/u/${maya}/`)
    await samPage.getByRole('button', { name: 'Add friend' }).click()
    const step = samPage.getByRole('dialog', { name: 'Make a free account' })
    await expect(step).toBeVisible()
    await expect(step.getByRole('checkbox', { name: `Add @${maya} as a friend` })).toBeChecked()
    // A shared page has no app top bar, so the step covers the whole page, its top bar too.
    expect((await step.boundingBox())?.y).toBe(0)
  })

  await test.step('sam signs up and picks a Handle, and the request is on the server', async () => {
    await signUpInTheStep(samPage, newEmail(testInfo, 'sam'))
    const dialog = samPage.getByRole('alertdialog')
    await dialog.getByRole('textbox', { name: 'Handle' }).fill(sam)
    await expect(dialog.getByText(`@${sam} is free`)).toBeVisible()
    await dialog.getByRole('button', { name: 'Add friend' }).click()
    await expect(dialog).toBeHidden()

    const home = samPage.getByRole('dialog', { name: 'Get the app' })
    await expect(home).toContainText(`You asked @${maya} to be friends.`)
    expect(await requestsTo(page)).toEqual([sam])
    await home.getByRole('button', { name: 'Done' }).click()
    await expect(samPage.getByRole('button', { name: 'Requested' })).toBeVisible()
  })

  await samPage.context().close()
})
