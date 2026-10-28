import { env } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as authRoute from '@/app/api/auth/[...all]/route'
import { session, user, verification } from '@/db/schema'
import { listCapturedEmails } from '@/server/dev-mailbox'
import { api, ORIGIN, recordingMetadata, testDb, uploadBody, wav } from '@/test-support/library-api'
import { fakeSiteverify, TEST_TOKEN } from '@/test-support/turnstile'

vi.unmock('@/server/session-user')

const R1 = '11111111-1111-4111-8111-111111111111'
const bindings = env as unknown as { SITE_ENV?: string; DEV_MAILBOX: KVNamespace }

function authPost(path: string, body: unknown): Request {
  return new Request(`${ORIGIN}/api/auth${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: ORIGIN,
      'x-captcha-response': TEST_TOKEN
    },
    body: JSON.stringify(body)
  })
}

async function sendCode(email: string) {
  const response = await authRoute.POST(
    authPost('/email-otp/send-verification-otp', { email, type: 'sign-in' })
  )
  expect(response.status).toBe(200)
}

async function signIn(email: string): Promise<{ id: string; cookie: string }> {
  await sendCode(email)
  const mail = (await listCapturedEmails(bindings.DEV_MAILBOX)).find(m => m.to === email)
  const otp = mail?.text.split('\n').find(line => /^\d+$/.test(line))
  const response = await authRoute.POST(authPost('/sign-in/email-otp', { email, otp }))
  expect(response.status).toBe(200)
  const cookie = response.headers
    .getSetCookie()
    .map(header => header.split(';')[0])
    .filter(pair => pair.includes('session_token'))
    .join('; ')
  expect(cookie).not.toBe('')
  const [row] = await testDb().select({ id: user.id }).from(user).where(eq(user.email, email))
  return { id: row.id, cookie }
}

const verificationsFor = (email: string) =>
  testDb()
    .select({ id: verification.id })
    .from(verification)
    .where(eq(verification.identifier, `sign-in-otp-${email}`))

beforeEach(() => {
  fakeSiteverify()
})

afterEach(() => {
  delete bindings.SITE_ENV
  vi.restoreAllMocks()
})

describe('the library with sign-in’s session', () => {
  it('answers 401 signed out, or with a cookie that names no session', async () => {
    expect((await api.library({})).status).toBe(401)
    const forged = await api.library({ cookie: 'pedos.session_token=forged.signature' })
    expect(forged.status).toBe(401)
    expect(await forged.json()).toEqual({ error: 'signed_out' })
  })

  it('serves a signed-in user their library, and keeps their uploads', async () => {
    const a = await signIn('a@example.test')

    const put = await api.put('recordings', R1, uploadBody(recordingMetadata(R1), wav()), a)
    expect(put.status).toBe(201)
    const library = await api.library(a)
    expect(library.status).toBe(200)
    const body = (await library.json()) as { recordings: { id: string }[] }
    expect(body.recordings.map(recording => recording.id)).toEqual([R1])
  })

  it('answers 503, not 401, when sign-in isn’t set up here', async () => {
    const a = await signIn('a@example.test')
    bindings.SITE_ENV = 'neither'

    const responses = [
      await api.library(a),
      await api.library({}),
      await api.put('recordings', R1, uploadBody(recordingMetadata(R1), wav()), a),
      await api.deleteAccount(a)
    ]

    expect(responses.map(response => response.status)).toEqual([503, 503, 503, 503])
    expect(await responses[0].json()).toEqual({ error: 'auth_unavailable' })
    expect(responses[0].headers.get('cache-control')).toBe('private, no-store')
    expect(await testDb().select().from(user).where(eq(user.id, a.id))).toHaveLength(1)
  })
})

describe('DELETE /api/account/ with sign-in’s session', () => {
  it('deletes the user’s sessions and their waiting sign-in codes, and no one else’s', async () => {
    const a = await signIn('a@example.test')
    const b = await signIn('b@example.test')
    const aElsewhere = await signIn('a@example.test')
    await sendCode('a@example.test')
    await sendCode('b@example.test')
    const sessionsOf = (id: string) => testDb().select().from(session).where(eq(session.userId, id))
    expect(await sessionsOf(a.id)).toHaveLength(2)
    expect(await verificationsFor('a@example.test')).toHaveLength(1)

    const response = await api.deleteAccount(a)

    expect(response.status).toBe(204)
    expect(await sessionsOf(a.id)).toEqual([])
    expect(await verificationsFor('a@example.test')).toEqual([])
    expect((await api.library(a)).status).toBe(401)
    expect((await api.library(aElsewhere)).status).toBe(401)
    expect(await sessionsOf(b.id)).toHaveLength(1)
    expect(await verificationsFor('b@example.test')).toHaveLength(1)
    expect((await api.library(b)).status).toBe(200)
  })

  it('refuses a sign-in 10 minutes old, and deletes once a new code signs in again', async () => {
    const old = await signIn('a@example.test')
    await testDb()
      .update(session)
      .set({ createdAt: new Date(Date.now() - 10 * 60_000) })
      .where(eq(session.userId, old.id))

    const refused = await api.deleteAccount(old)
    expect(refused.status).toBe(403)
    expect(await refused.json()).toEqual({ error: 'sign_in_again' })
    expect(await testDb().select().from(user).where(eq(user.id, old.id))).toHaveLength(1)

    const again = await signIn('a@example.test')
    expect(again.id).toBe(old.id)
    expect((await api.deleteAccount(again)).status).toBe(204)
    expect(await testDb().select().from(user).where(eq(user.id, old.id))).toEqual([])
    expect(await testDb().select().from(session).where(eq(session.userId, old.id))).toEqual([])
  })
})
