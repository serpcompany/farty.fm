import { randomInt } from 'node:crypto'
import type { BrowserContext, Page, TestInfo } from '@playwright/test'
import { uploaded } from './database'
import { recordG3ToRecordings, skipWelcome } from './record'
import { expect } from './test'

export const TURNSTILE_TEST_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'

export function newEmail(testInfo: TestInfo, name: string): string {
  return `${name}-${testInfo.project.name}-${Date.now()}-${randomInt(1e6)}@example.com`
}

export async function ownClient(context: BrowserContext): Promise<void> {
  const address = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`
  await context.route(
    url => url.hostname === 'localhost' || url.hostname === '127.0.0.1',
    route =>
      route.continue({ headers: { ...route.request().headers(), 'cf-connecting-ip': address } })
  )
}

export async function codeFor(page: Page, email: string): Promise<string> {
  let code: string | undefined
  await expect(async () => {
    const html = await (await page.request.get('/dev/mail/')).text()
    const mail = html
      .split('data-testid="dev-mail"')
      .slice(1)
      .find(mail => mail.includes(email))
    code = mail?.split('<pre')[1]?.match(/\b(\d{6})\b/)?.[1]
    expect(code).toMatch(/^\d{6}$/)
  }).toPass({ timeout: 15_000 })
  return code as string
}

export async function signInByApi(page: Page, email: string): Promise<void> {
  await ownClient(page.context())
  const post = (path: string, body: unknown) =>
    page.evaluate(
      async ({ path, body, token }) =>
        (
          await fetch(path, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-captcha-response': token },
            body: JSON.stringify(body)
          })
        ).status,
      { path, body, token: TURNSTILE_TEST_TOKEN }
    )
  expect(await post('/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' })).toBe(
    200
  )
  const otp = await codeFor(page, email)
  expect(await post('/api/auth/sign-in/email-otp', { email, otp })).toBe(200)
}

export function session(
  page: Page
): Promise<{ user: { email: string; marketingEmail: boolean } } | null> {
  return page.evaluate(async () => (await fetch('/api/auth/get-session')).json())
}

export function accountOf(page: Page): Promise<string | null> {
  return page.evaluate(() => localStorage.getItem('pedos.account'))
}

export async function reopen(context: BrowserContext, page: Page): Promise<Page> {
  await page.close()
  const reopened = await context.newPage()
  await reopened.goto('/recordings/')
  return reopened
}

export async function expiredWithARecording(
  page: Page,
  context: BrowserContext,
  email: string
): Promise<Page> {
  await page.addInitScript(skipWelcome)
  await page.goto('/profile/')
  await signInByApi(page, email)
  await recordG3ToRecordings(page)
  await uploaded(page)
  await context.clearCookies()
  return reopen(context, page)
}
