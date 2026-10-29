import type { Page } from '@playwright/test'
import { ownClient, TURNSTILE_TEST_TOKEN } from './account'
import { expect, test } from './test'

type Answer = { status: number; body: unknown }

function call(
  page: Page,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  token: string | null = TURNSTILE_TEST_TOKEN
): Promise<Answer> {
  return page.evaluate(
    async ({ method, path, body, token }) => {
      const headers: Record<string, string> = {}
      if (body !== undefined) headers['content-type'] = 'application/json'
      if (token !== null) headers['x-captcha-response'] = token
      const response = await fetch(path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
      })
      return { status: response.status, body: await response.json() }
    },
    { method, path, body, token }
  )
}

test('a code from the dev mailbox signs in to the library, and signing out ends the session', async ({
  page,
  pageErrors
}, testInfo) => {
  pageErrors.expect('the server responded with a status of 401')
  const email = `fan-${testInfo.project.name}-${Date.now()}@example.com`
  await page.goto('/privacy/')

  expect(await call(page, 'GET', '/api/auth/get-session')).toEqual({ status: 200, body: null })
  expect(await call(page, 'GET', '/api/library/')).toEqual({
    status: 401,
    body: { error: 'signed_out' }
  })
  expect(
    await call(page, 'POST', '/api/auth/email-otp/send-verification-otp', {
      email,
      type: 'sign-in'
    })
  ).toEqual({ status: 200, body: { success: true } })

  await page.goto('/dev/mail/')
  const mail = page.getByTestId('dev-mail').filter({ hasText: email }).first()
  await expect(mail).toContainText('is your Farty sign-in code')
  const code = (await mail.locator('pre').innerText()).match(/^\d{6}$/m)?.[0]
  expect(code).toMatch(/^\d{6}$/)

  const signedIn = await call(page, 'POST', '/api/auth/sign-in/email-otp', { email, otp: code })
  expect(signedIn).toMatchObject({ status: 200, body: { user: { email } } })
  const session = await call(page, 'GET', '/api/auth/get-session')
  expect(session).toMatchObject({
    status: 200,
    body: { user: { email, emailVerified: true, marketingEmail: true } }
  })
  const cookies = await page.context().cookies()
  expect(cookies.find(cookie => cookie.name === 'pedos.session_token')).toMatchObject({
    httpOnly: true,
    sameSite: 'Lax'
  })
  expect(await call(page, 'GET', '/api/library/')).toMatchObject({
    status: 200,
    body: { recordings: [], toots: [] }
  })

  expect(await call(page, 'POST', '/api/auth/sign-out', {})).toMatchObject({ status: 200 })
  expect(await call(page, 'GET', '/api/auth/get-session')).toEqual({ status: 200, body: null })
  expect((await call(page, 'GET', '/api/library/')).status).toBe(401)
})

test('a code is sent only with a Turnstile token, and the page reads the site key', async ({
  page,
  pageErrors
}, testInfo) => {
  pageErrors.expect('the server responded with a status of 400')
  const email = `turnstile-${testInfo.project.name}-${Date.now()}@example.com`
  await ownClient(page.context())
  await page.goto('/privacy/')
  expect(await call(page, 'GET', '/api/auth/turnstile')).toEqual({
    status: 200,
    body: { siteKey: '1x00000000000000000000AA' }
  })
  const sendCode = (token: string | null) =>
    call(
      page,
      'POST',
      '/api/auth/email-otp/send-verification-otp',
      { email, type: 'sign-in' },
      token
    )
  expect(await sendCode(null)).toMatchObject({ status: 400 })
  expect(await sendCode(TURNSTILE_TEST_TOKEN)).toEqual({ status: 200, body: { success: true } })
})

test('a wrong code is refused, and only the four endpoints and the site key answer', async ({
  page,
  pageErrors
}) => {
  pageErrors.expect(/the server responded with a status of 40[04]/)
  await page.goto('/privacy/')
  const wrong = await call(page, 'POST', '/api/auth/sign-in/email-otp', {
    email: 'nobody@example.com',
    otp: '000000'
  })
  expect(wrong).toMatchObject({ status: 400 })
  for (const path of ['/api/auth/ok', '/api/auth/list-sessions', '/api/auth/sign-up/email']) {
    expect(await call(page, 'GET', path)).toMatchObject({ status: 404 })
  }
})
