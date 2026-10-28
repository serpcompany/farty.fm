import { describe, expect, it } from 'vitest'

import {
  answer,
  expectSmokeTestAnswers,
  get,
  LOCAL,
  post,
  SECRET,
  type Sent,
  STAGING,
  STAGING_WORKERS_DEV,
  sendCode,
  sessionCookie,
  signInHarness,
  trySignIn
} from '@/test-support/sign-in'

import { GET_SESSION_ENDPOINT, SIGN_OUT_ENDPOINT } from './auth-endpoints'
import { serveAuthRequest } from './auth-request'
import { AuthUnavailableError, readSessionUser } from './auth-session'
import {
  type AuthEnv,
  resolveAuthSettings,
  TURNSTILE_TEST_SECRET_KEY,
  TURNSTILE_TEST_SITE_KEY
} from './auth-settings'
import { SESSION_EXPIRES_SECONDS, SESSION_UPDATE_AGE_SECONDS } from './create-auth'

const { db, local, staging, mailedCode, signIn, rows } = signInHarness()

describe('local sign-in', () => {
  it('signs in with the mailed code, reads the session from D1, and signs out', async () => {
    const cookie = await signIn('Fan@Example.com')
    const session = await serveAuthRequest(get(GET_SESSION_ENDPOINT, { cookie }), local())
    const { user } = (await session.json()) as { user: Record<string, unknown> }
    expect(user).toMatchObject({
      email: 'fan@example.com',
      emailVerified: true,
      marketingEmail: true
    })

    const request = new Request(LOCAL, { headers: { cookie } })
    expect(await readSessionUser(request, local())).toEqual({
      id: user.id,
      email: 'fan@example.com',
      marketingEmail: true,
      signedInAt: expect.any(Date)
    })
    expect(await rows('SELECT marketing_email FROM user')).toEqual([{ marketing_email: 1 }])

    const out = await serveAuthRequest(post(SIGN_OUT_ENDPOINT, {}, { cookie }), local())
    expect(out.status).toBe(200)
    expect(await readSessionUser(request, local())).toBeNull()
    expect(await rows('SELECT id FROM session')).toEqual([])
  })

  it('reads no session without a cookie, or with a forged one', async () => {
    await signIn('fan@example.com')
    const none = new Request(LOCAL)
    const forged = new Request(LOCAL, { headers: { cookie: 'pedos.session_token=abc.def' } })
    expect(await readSessionUser(none, local())).toBeNull()
    expect(await readSessionUser(forged, local())).toBeNull()
  })

  it('reads the session from D1 every time, with no cookie cache', async () => {
    await sendCode(local(), 'fan@example.com')
    const response = await trySignIn(
      local(),
      'fan@example.com',
      await mailedCode('fan@example.com')
    )
    const cookies = response.headers.getSetCookie().map(set => set.split(';')[0])
    expect(cookies.map(set => set.split('=')[0])).toEqual(['pedos.session_token'])
    const cookie = cookies.join('; ')
    const request = new Request(LOCAL, { headers: { cookie } })
    expect(await readSessionUser(request, local())).not.toBeNull()
    await db().prepare('DELETE FROM session').run()
    expect(await readSessionUser(request, local())).toBeNull()
    const session = await serveAuthRequest(get(GET_SESSION_ENDPOINT, { cookie }), local())
    expect(await session.json()).toBeNull()
  })

  it('keeps a session 7 days, moved on when read a day or more after', async () => {
    expect([SESSION_EXPIRES_SECONDS, SESSION_UPDATE_AGE_SECONDS]).toEqual([7 * 86_400, 86_400])
    const week = 7 * 86_400_000
    const before = Date.now()
    const cookie = await signIn('fan@example.com')
    const expiry = async () =>
      (await rows<{ expires_at: number }>('SELECT expires_at FROM session'))[0].expires_at
    expect(await expiry()).toBeGreaterThanOrEqual(before + week)
    expect(await expiry()).toBeLessThanOrEqual(Date.now() + week)
    const age = (ms: number) =>
      db().prepare('UPDATE session SET expires_at = expires_at - ?').bind(ms).run()
    const request = new Request(LOCAL, { headers: { cookie } })

    await age(23 * 3_600_000)
    const kept = await expiry()
    expect(await readSessionUser(request, local())).not.toBeNull()
    expect(await expiry()).toBe(kept)

    await age(25 * 3_600_000)
    const reading = Date.now()
    expect(await readSessionUser(request, local())).not.toBeNull()
    expect(await expiry()).toBeGreaterThanOrEqual(reading + week)

    await age(2 * 86_400_000)
    const session = await serveAuthRequest(get(GET_SESSION_ENDPOINT, { cookie }), local())
    expect(session.status).toBe(200)
    const set = session.headers.getSetCookie().find(line => line.includes('session_token'))
    expect(set).toMatch(/Max-Age=604800/)
  })

  it('reads the time of the sign-in itself, which renewing the session never moves', async () => {
    const before = Date.now()
    const cookie = await signIn('fan@example.com')
    const request = new Request(LOCAL, { headers: { cookie } })
    const signedInAt = async () => (await readSessionUser(request, local()))?.signedInAt.getTime()
    const signedIn = (await signedInAt()) ?? 0
    expect(signedIn).toBeGreaterThanOrEqual(before)
    expect(signedIn).toBeLessThanOrEqual(Date.now())

    const twoDays = 2 * 86_400_000
    await db()
      .prepare('UPDATE session SET created_at = created_at - ?1, expires_at = expires_at - ?1')
      .bind(twoDays)
      .run()
    const reading = Date.now()

    expect(await signedInAt()).toBe(signedIn - twoDays)
    const [row] = await rows<{ created_at: number; expires_at: number }>(
      'SELECT created_at, expires_at FROM session'
    )
    expect(row.created_at).toBe(signedIn - twoDays)
    expect(row.expires_at).toBeGreaterThanOrEqual(reading + SESSION_EXPIRES_SECONDS * 1000)
  })

  it('keeps no IP address or user agent with a session', async () => {
    await signIn('fan@example.com', { headers: { 'user-agent': 'Mozilla/5.0 Test' } })
    expect(await rows('SELECT ip_address, user_agent FROM session')).toEqual([
      { ip_address: null, user_agent: null }
    ])
  })
})

describe('Staging', () => {
  it('sends codes from the support address, to its allowlist only', async () => {
    const sent: Sent = []
    expect((await sendCode(staging(sent), 'member@example.com', { base: STAGING })).status).toBe(
      200
    )
    expect((await sendCode(staging(sent), 'other@example.com', { base: STAGING })).status).toBe(200)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      from: { name: 'Farty', email: 'support@farty.fm' },
      to: 'member@example.com',
      subject: expect.stringMatching(/^\d{6} is your Farty sign-in code$/)
    })
  })

  it('creates no account off the allowlist, should it change after the code was sent', async () => {
    const sent: Sent = []
    await sendCode(staging(sent), 'member@example.com', { base: STAGING })
    const code = String(sent[0].subject).slice(0, 6)
    const changed = staging(sent, { STAGING_SIGNUP_ALLOWLIST: 'someone@example.com' })
    const response = await trySignIn(changed, 'member@example.com', code, { base: STAGING })
    expect(await answer(response)).toMatchObject({ status: 400, body: { code: 'INVALID_OTP' } })
    expect(await rows('SELECT id FROM user')).toEqual([])
  })

  it('signs in with a secure cookie, and answers the smoke test', async () => {
    const sent: Sent = []
    await sendCode(staging(sent), 'member@example.com', { base: STAGING })
    const code = String(sent[0].subject).slice(0, 6)
    const response = await trySignIn(staging(sent), 'member@example.com', code, { base: STAGING })
    expect(response.status).toBe(200)
    const cookie = sessionCookie(response)
    expect(cookie).toMatch(/^__Secure-pedos\.session_token=/)
    expect(response.headers.getSetCookie()[0]).toMatch(/; Secure/i)
    await expectSmokeTestAnswers(staging(sent), STAGING_WORKERS_DEV, STAGING)
  })
})

describe('Production', () => {
  it('answers the smoke test on workers.dev', async () => {
    const env: AuthEnv = {
      SITE_ENV: 'production',
      DB: db(),
      EMAIL: { send: async () => ({ messageId: 'test' }) },
      EMAIL_FROM: 'Farty <support@farty.fm>',
      BETTER_AUTH_URL: 'https://farty.fm',
      BETTER_AUTH_SECRET: SECRET
    }
    const workersDev = 'https://pedos-web-production.serpcompany.workers.dev'
    await expectSmokeTestAnswers(env, workersDev, 'https://farty.fm')
  })
})

describe('settings', () => {
  const deployed = {
    DB: {} as D1Database,
    SITE_ENV: 'production',
    BETTER_AUTH_URL: 'https://farty.fm',
    BETTER_AUTH_SECRET: SECRET
  }

  it('need the secret, the environment’s own URL and Staging’s allowlist', () => {
    expect(resolveAuthSettings(deployed)).toMatchObject({
      ok: true,
      settings: { baseURL: 'https://farty.fm', useSecureCookies: true, signupAllowlist: null }
    })
    const reasons = [
      { ...deployed, SITE_ENV: 'preview' },
      { ...deployed, BETTER_AUTH_SECRET: undefined },
      { ...deployed, BETTER_AUTH_SECRET: 'too-short' },
      { ...deployed, BETTER_AUTH_URL: undefined },
      { ...deployed, BETTER_AUTH_URL: 'https://staging.farty.fm' },
      { ...deployed, SITE_ENV: 'staging', BETTER_AUTH_URL: STAGING },
      { ...deployed, SITE_ENV: 'staging', BETTER_AUTH_URL: STAGING, STAGING_SIGNUP_ALLOWLIST: 'x' }
    ].map(env => {
      const result = resolveAuthSettings(env)
      return result.ok ? 'ok' : result.reason
    })
    expect(reasons).toEqual([
      'deployment_not_configured',
      'auth_secret_missing',
      'auth_secret_missing',
      'auth_url_invalid',
      'auth_url_invalid',
      'signup_allowlist_invalid',
      'signup_allowlist_invalid'
    ])
  })

  it('answer 503 when sign-in isn’t set up, and read no session', async () => {
    const env = { ...staging([]), BETTER_AUTH_SECRET: undefined }
    const response = await serveAuthRequest(get(GET_SESSION_ENDPOINT, { base: STAGING }), env)
    expect(await answer(response)).toMatchObject({
      status: 503,
      body: { code: 'AUTH_UNAVAILABLE' }
    })
    await expect(readSessionUser(new Request(STAGING), env)).rejects.toBeInstanceOf(
      AuthUnavailableError
    )
  })

  it('take Turnstile’s keys from the environment, or locally Cloudflare’s test keys', () => {
    const turnstile = (env: AuthEnv) => {
      const result = resolveAuthSettings(env)
      return result.ok ? result.settings.turnstile : result.reason
    }
    const keys = { TURNSTILE_SITE_KEY: 'site', TURNSTILE_SECRET_KEY: 'secret' }
    expect(turnstile({ ...deployed, ...keys })).toEqual({ siteKey: 'site', secretKey: 'secret' })
    expect(turnstile(deployed)).toBeNull()
    expect(turnstile({ ...deployed, ...keys, TURNSTILE_SECRET_KEY: ' ' })).toBeNull()
    expect(turnstile({ ...deployed, ...keys, TURNSTILE_SITE_KEY: undefined })).toBeNull()
    expect(turnstile(local())).toEqual({
      siteKey: TURNSTILE_TEST_SITE_KEY,
      secretKey: TURNSTILE_TEST_SECRET_KEY
    })
    expect(turnstile(local(keys))).toEqual({ siteKey: 'site', secretKey: 'secret' })
  })

  it('run locally without a secret, on any loopback host', async () => {
    const env = local({ BETTER_AUTH_SECRET: undefined })
    for (const base of ['http://localhost:4115', 'http://127.0.0.1:3000', 'http://[::1]:8787']) {
      const response = await serveAuthRequest(get(GET_SESSION_ENDPOINT, { base }), env)
      expect(response.status).toBe(200)
    }
  })
})
