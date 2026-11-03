import type { BrowserContext, Page } from '@playwright/test'
import { newEmail, ownClient, signUpInTheStep } from './account'
import { onPhone } from './screens'
import {
  friendRequestBeforeAHandle,
  newHandle,
  pickAHandle,
  shareARecording,
  signedInWithAHandle
} from './sharing'
import { expect, test } from './test'

test.use({ serviceWorkers: 'block' })

function requestsTo(page: Page): Promise<string[]> {
  return page.evaluate(
    async () => ((await (await fetch('/api/friends/')).json()) as { requests: string[] }).requests
  )
}

async function stranger(newContext: () => Promise<BrowserContext>): Promise<Page> {
  const context = await newContext()
  await ownClient(context)
  return context.newPage()
}

test('Get Farty on a shared page makes an account, asks the sharer to be friends, then shows the Home Screen steps', async ({
  page,
  newContext,
  viewport,
  pageErrors
}, testInfo) => {
  test.skip(!onPhone({ viewport }), "Get Farty's two steps are checked at phone size")
  pageErrors.expect(friendRequestBeforeAHandle)
  test.setTimeout(150_000)
  const maya = newHandle()
  const sam = newHandle()

  const link = await test.step('maya shares a Recording', async () => {
    await signedInWithAHandle(page, newEmail(testInfo, 'maya'), maya)
    return shareARecording(page)
  })

  const samPage = await stranger(newContext)

  await test.step('signed out, Get Farty opens the account step, offering maya, ticked', async () => {
    await samPage.goto(link)
    await expect(samPage.getByText(`@${maya} shared a Recording`)).toBeVisible()
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
    await pickAHandle(samPage, sam, 'Add friend')

    const home = samPage.getByRole('dialog', { name: 'Get the app' })
    await expect(home).toBeVisible()
    await expect(home).toContainText(`You asked @${maya} to be friends.`)
    await expect(home.getByTestId('install-guide')).toBeVisible()
    await expect(home.getByRole('heading', { name: 'Get the app' })).toBeFocused()
    await testInfo.attach('Home Screen step', {
      body: await samPage.screenshot(),
      contentType: 'image/png'
    })

    expect(await requestsTo(page)).toEqual([sam])

    await home.getByRole('button', { name: 'Done' }).click()
    await expect(home).toBeHidden()
    await expect(samPage.getByRole('link', { name: 'Open Farty' })).toBeVisible()
  })

  await test.step('someone who unticks it signs up and asks no one', async () => {
    const leePage = await stranger(newContext)
    await leePage.goto(link)
    await leePage.getByRole('button', { name: 'Get Farty' }).first().click()
    const offer = leePage.getByRole('checkbox', { name: `Add @${maya} as a friend` })
    await offer.uncheck()
    await expect(offer).not.toBeChecked()

    await signUpInTheStep(leePage, newEmail(testInfo, 'lee'))
    const home = leePage.getByRole('dialog', { name: 'Get the app' })
    await expect(home).toBeVisible()
    await expect(home).not.toContainText(`@${maya}`)
    await expect(leePage.getByRole('alertdialog')).toHaveCount(0)
    expect(await requestsTo(page)).toEqual([sam])
  })
})

test("signed out, a profile page's Add friend is Get Farty, and the request reaches the server", async ({
  page,
  newContext,
  pageErrors
}, testInfo) => {
  test.setTimeout(120_000)
  pageErrors.expect(friendRequestBeforeAHandle)
  const maya = newHandle()
  const sam = newHandle()

  await test.step('maya has an account and a Handle', async () => {
    await signedInWithAHandle(page, newEmail(testInfo, 'maya'), maya)
  })

  const samPage = await stranger(newContext)

  await test.step("Add friend on maya's page opens the account step, offering maya, ticked", async () => {
    await samPage.goto(`/u/${maya}/`)
    await samPage.getByRole('button', { name: 'Add friend' }).click()
    const step = samPage.getByRole('dialog', { name: 'Make a free account' })
    await expect(step).toBeVisible()
    await expect(step.getByRole('checkbox', { name: `Add @${maya} as a friend` })).toBeChecked()
    expect((await step.boundingBox())?.y).toBe(0)
  })

  await test.step('sam signs up and picks a Handle, and the request is on the server', async () => {
    await signUpInTheStep(samPage, newEmail(testInfo, 'sam'))
    await pickAHandle(samPage, sam, 'Add friend')

    const home = samPage.getByRole('dialog', { name: 'Get the app' })
    await expect(home).toContainText(`You asked @${maya} to be friends.`)
    expect(await requestsTo(page)).toEqual([sam])
    await home.getByRole('button', { name: 'Done' }).click()
    await expect(samPage.getByRole('button', { name: 'Requested' })).toBeVisible()
  })
})
