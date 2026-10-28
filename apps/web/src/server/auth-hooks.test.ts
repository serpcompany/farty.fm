import { describe, expect, it } from 'vitest'

import {
  answer,
  post,
  SECRET,
  type Sent,
  STAGING,
  sendCode,
  signInHarness,
  trySignIn
} from '@/test-support/sign-in'

import { SEND_CODE_ENDPOINT, SIGN_IN_ENDPOINT } from './auth-endpoints'
import { serveAuthRequest } from './auth-request'
import { hashSignInCode } from './create-auth'
import { SIGN_IN_CODE_ATTEMPTS, SIGN_IN_CODE_LENGTH, SIGN_IN_CODE_MINUTES } from './email'

const { db, local, staging, mailed, mailedCode, mailCount, signIn, rows } = signInHarness()

describe('a code request or sign-in', () => {
  it('refuses any field but email and otp, or email and type, and any code type but sign-in', async () => {
    const extra = await serveAuthRequest(
      post(SIGN_IN_ENDPOINT, { email: 'fan@example.com', otp: '123456', name: 'Fan' }),
      local()
    )
    expect(await answer(extra)).toMatchObject({ status: 400, body: { code: 'FIELD_NOT_ALLOWED' } })
    const extraSend = await serveAuthRequest(
      post(SEND_CODE_ENDPOINT, { email: 'fan@example.com', type: 'sign-in', name: 'Fan' }),
      local()
    )
    expect(await answer(extraSend)).toMatchObject({
      status: 400,
      body: { code: 'FIELD_NOT_ALLOWED' }
    })
    const reset = await serveAuthRequest(
      post(SEND_CODE_ENDPOINT, { email: 'fan@example.com', type: 'forget-password' }),
      local()
    )
    expect(await answer(reset)).toMatchObject({
      status: 400,
      body: { code: 'UNSUPPORTED_OTP_TYPE' }
    })
    expect(await mailCount('fan@example.com')).toBe(0)
  })

  it('refuses a code request for a missing or malformed email itself', async () => {
    for (const body of [{ type: 'sign-in' }, { email: 'not-an-email', type: 'sign-in' }]) {
      const response = await serveAuthRequest(post(SEND_CODE_ENDPOINT, body), local())
      expect(await answer(response)).toEqual({
        status: 400,
        body: { code: 'INVALID_EMAIL', message: 'Enter a valid email address.' }
      })
    }
    expect(await mailed()).toEqual([])
  })

  it('refuses a code request when email goes nowhere', async () => {
    const response = await sendCode(local({ DEV_MAILBOX: undefined }), 'fan@example.com')
    expect(await answer(response)).toMatchObject({
      status: 503,
      body: { code: 'OTP_DELIVERY_UNAVAILABLE' }
    })
  })
})

describe('codes', () => {
  it('are six digits in one unbroken run', async () => {
    for (const n of [1, 2, 3, 4, 5]) await sendCode(local(), `fan${n}@example.com`)
    const emails = await mailed()
    expect(emails).toHaveLength(5)
    for (const email of emails) {
      const code = await mailedCode(email.to)
      expect(code).toMatch(/^\d{6}$/)
      expect(email.subject).toBe(`${code} is your Farty sign-in code`)
      expect(email.html).toContain(`>${code}</p>`)
    }
  })

  it('sign in when typed with spaces or a dash', async () => {
    await sendCode(local(), 'fan@example.com')
    const code = await mailedCode('fan@example.com')
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`
    expect((await trySignIn(local(), 'fan@example.com', spaced)).status).toBe(200)
    await sendCode(local(), 'fan@example.com')
    const again = await mailedCode('fan@example.com')
    const dashed = `${again.slice(0, 3)}-${again.slice(3)}`
    expect((await trySignIn(local(), 'fan@example.com', dashed)).status).toBe(200)
  })

  it('are stored only as an HMAC under the secret', async () => {
    await sendCode(local(), 'fan@example.com')
    const code = await mailedCode('fan@example.com')
    const [stored] = await rows<{ value: string }>(
      "SELECT value FROM verification WHERE identifier = 'sign-in-otp-fan@example.com'"
    )
    const digest = stored.value.slice(0, stored.value.lastIndexOf(':'))
    expect(digest).not.toContain(code)
    const sha256 = Buffer.from(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code))
    ).toString('base64url')
    expect(digest).not.toBe(sha256)
    expect(digest).toBe(await hashSignInCode(SECRET, code))
  })

  it('are 6 digits, live 10 minutes and allow 3 guesses, defined once', async () => {
    expect([SIGN_IN_CODE_LENGTH, SIGN_IN_CODE_MINUTES, SIGN_IN_CODE_ATTEMPTS]).toEqual([6, 10, 3])
    const before = Date.now()
    await sendCode(local(), 'fan@example.com')
    const after = Date.now()
    const code = await mailedCode('fan@example.com')
    expect(code).toMatch(/^\d{6}$/)
    const [stored] = await rows<{ expires_at: number }>(
      "SELECT expires_at FROM verification WHERE identifier = 'sign-in-otp-fan@example.com'"
    )
    expect(stored.expires_at).toBeGreaterThanOrEqual(before + 10 * 60_000)
    expect(stored.expires_at).toBeLessThanOrEqual(after + 10 * 60_000)
    const wrong = code === '000000' ? '111111' : '000000'
    for (const _ of [1, 2, 3]) {
      const guess = await trySignIn(local(), 'fan@example.com', wrong)
      expect(await answer(guess)).toMatchObject({ status: 400, body: { code: 'INVALID_OTP' } })
    }
    const right = await trySignIn(local(), 'fan@example.com', code)
    expect(right.status).toBe(403)
  })

  it('stop working once they expire', async () => {
    await sendCode(local(), 'fan@example.com')
    const code = await mailedCode('fan@example.com')
    await db()
      .prepare('UPDATE verification SET expires_at = ?')
      .bind(Date.now() - 1000)
      .run()
    const late = await trySignIn(local(), 'fan@example.com', code)
    expect(await answer(late)).toMatchObject({ status: 400, body: { code: 'OTP_EXPIRED' } })
    expect(await rows('SELECT id FROM session')).toEqual([])
  })
})

describe('no answer says whether an email has an account', () => {
  it('a code request', async () => {
    await signIn('member@example.com')
    const member = await sendCode(local(), 'member@example.com', { ip: '203.0.113.2' })
    const stranger = await sendCode(local(), 'stranger@example.com', { ip: '203.0.113.2' })
    expect(await answer(member)).toEqual(await answer(stranger))
    expect([...member.headers.keys()]).toEqual([...stranger.headers.keys()])
    expect(await mailCount('member@example.com')).toBe(2)
    expect(await mailCount('stranger@example.com')).toBe(1)
  })

  it('a wrong code, with or without a code sent', async () => {
    await signIn('member@example.com')
    for (const sent of [false, true]) {
      if (sent) {
        await sendCode(local(), 'member@example.com')
        await sendCode(local(), 'stranger@example.com')
      }
      const member = await trySignIn(local(), 'member@example.com', '12345')
      const stranger = await trySignIn(local(), 'stranger@example.com', '12345')
      expect(await answer(member)).toEqual(await answer(stranger))
      expect(member.status).toBe(400)
    }
  })

  it('a code request past a per-email limit, or off Staging’s allowlist', async () => {
    const sent: Sent = []
    const env = staging(sent)
    const ip = (n: number) => ({ base: STAGING, ip: `198.51.100.${n}` })
    const allowed = await sendCode(env, 'member@example.com', ip(1))
    const other = await sendCode(env, 'other@example.com', ip(2))
    expect(await answer(other)).toEqual(await answer(allowed))
    expect(allowed.status).toBe(200)
    for (let n = 2; n <= 5; n++) await sendCode(env, 'member@example.com', ip(1))
    const held = await sendCode(env, 'member@example.com', ip(1))
    expect(await answer(held)).toEqual({ status: 200, body: { success: true } })
    expect([...held.headers.keys()]).toEqual([...allowed.headers.keys()])
    expect(sent.map(message => message.to)).toEqual(Array(5).fill('member@example.com'))
  })
})
