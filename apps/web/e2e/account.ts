import { randomInt } from 'node:crypto'
import { type BrowserContext, expect, type Page, type TestInfo } from '@playwright/test'

// Accounts in the journeys (#155): sign-in codes come from the dev mailbox (`/dev/mail/`), which
// only a local run without `--env` has, as on CI.

/** A new email for one test, so no two tests share an account or a code. */
export function newEmail(testInfo: TestInfo, name: string): string {
  return `${name}-${testInfo.project.name}-${Date.now()}-${randomInt(1e6)}@example.com`
}

/**
 * Gives the context a client address of its own. Locally every request comes from 127.0.0.1, so
 * the tests would share one client's limit on sign-in codes (10 in 10 minutes); Cloudflare sets
 * this header itself, so only a local run can.
 */
export async function ownClient(context: BrowserContext): Promise<void> {
  const address = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`
  await context.setExtraHTTPHeaders({ 'cf-connecting-ip': address })
}

/** The newest sign-in code the dev mailbox holds for `email`, as a person reads their email. */
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

/**
 * Signs in to a new account with the page's own requests, as the account step makes them. The
 * page must be on Farty; reload it after, so Farty reads the session as it opens.
 */
export async function signInByApi(page: Page, email: string): Promise<void> {
  await ownClient(page.context())
  const post = (path: string, body: unknown) =>
    page.evaluate(
      async ({ path, body }) =>
        (
          await fetch(path, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body)
          })
        ).status,
      { path, body }
    )
  expect(await post('/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' })).toBe(
    200
  )
  const otp = await codeFor(page, email)
  expect(await post('/api/auth/sign-in/email-otp', { email, otp })).toBe(200)
}

/** What the session says, from the page itself. */
export function session(
  page: Page
): Promise<{ user: { email: string; marketingEmail: boolean } } | null> {
  return page.evaluate(async () => (await fetch('/api/auth/get-session')).json())
}
