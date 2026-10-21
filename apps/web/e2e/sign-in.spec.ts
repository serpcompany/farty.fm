import { expect, type Page, test } from '@playwright/test'

// Sign-in end to end (#152), with no sign-in screen yet: the page itself calls the auth API, as
// the app will, and reads its code from the dev mailbox, as a person reads their email.

type Answer = { status: number; body: unknown }

/** A request from the page itself, so the browser sends its own Origin and cookies. */
function call(page: Page, method: 'GET' | 'POST', path: string, body?: unknown): Promise<Answer> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const response = await fetch(path, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      })
      return { status: response.status, body: await response.json() }
    },
    { method, path, body }
  )
}

test('a code from the dev mailbox signs in to the library, and signing out ends the session', async ({
  page
}, testInfo) => {
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
  // The library routes take the same session (src/server/session-user.ts).
  expect(await call(page, 'GET', '/api/library/')).toMatchObject({
    status: 200,
    body: { recordings: [], toots: [] }
  })

  expect(await call(page, 'POST', '/api/auth/sign-out', {})).toMatchObject({ status: 200 })
  expect(await call(page, 'GET', '/api/auth/get-session')).toEqual({ status: 200, body: null })
  expect((await call(page, 'GET', '/api/library/')).status).toBe(401)
})

test('a wrong code is refused, and only the four endpoints answer', async ({ page }) => {
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
