import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as authRoute from '@/app/api/auth/[...all]/route'
import { TURNSTILE_TEST_SECRET_KEY, TURNSTILE_TEST_SITE_KEY } from '@/server/auth-settings'
import { listCapturedEmails } from '@/server/dev-mailbox'
import { ORIGIN } from '@/test-support/library-api'
import { fakeSiteverify, siteverifyCalls, TEST_TOKEN } from '@/test-support/turnstile'

const bindings = env as unknown as { DEV_MAILBOX: KVNamespace }

function sendCode(email: string, token: string | null): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/json', origin: ORIGIN })
  if (token !== null) headers.set('x-captcha-response', token)
  return authRoute.POST(
    new Request(`${ORIGIN}/api/auth/email-otp/send-verification-otp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, type: 'sign-in' })
    })
  )
}

const mailTo = async (email: string) =>
  (await listCapturedEmails(bindings.DEV_MAILBOX)).filter(mail => mail.to === email)

beforeEach(() => {
  fakeSiteverify()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('sending a sign-in code', () => {
  it('is refused without a Turnstile token, and sends nothing', async () => {
    const response = await sendCode('fan@example.test', null)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'MISSING_RESPONSE' })
    expect(await mailTo('fan@example.test')).toEqual([])
  })

  it('is refused with a token Turnstile rejects', async () => {
    const response = await sendCode('fan@example.test', 'not-a-token')
    expect(response.status).toBe(403)
    expect(await mailTo('fan@example.test')).toEqual([])
  })

  it('sends the code with the test token, checked with the test secret', async () => {
    const response = await sendCode('fan@example.test', TEST_TOKEN)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(await mailTo('fan@example.test')).toHaveLength(1)
    expect(siteverifyCalls()).toEqual([
      expect.objectContaining({ secret: TURNSTILE_TEST_SECRET_KEY, response: TEST_TOKEN })
    ])
  })
})

describe('GET /api/auth/turnstile', () => {
  it('answers wrangler.jsonc’s local site key, never cached', async () => {
    const response = await authRoute.GET(new Request(`${ORIGIN}/api/auth/turnstile`))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ siteKey: TURNSTILE_TEST_SITE_KEY })
  })
})
