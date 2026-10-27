import { env } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { markTootPaid, startTootPayment } from '@/db/payments'
import { recordings, session, tootPayments, toots, user, verification } from '@/db/schema'
import { TOOT_PRICE } from '@/lib/pricing'
import { deleteAccount } from '@/server/library'
import {
  api,
  bucketKeys,
  ORIGIN,
  recordingMetadata,
  signUp,
  testDb,
  tootMetadata,
  uploadBody,
  wav
} from '@/test-support/library-api'

// The account routes in workerd, with a real D1 and R2.

const R1 = '11111111-1111-4111-8111-111111111111'
const T1 = '33333333-3333-4333-8333-333333333333'

async function rowsOf(userId: string) {
  const db = testDb()
  return {
    users: await db.select().from(user).where(eq(user.id, userId)),
    sessions: await db.select().from(session).where(eq(session.userId, userId)),
    recordings: await db.select().from(recordings).where(eq(recordings.userId, userId)),
    toots: await db.select().from(toots).where(eq(toots.userId, userId)),
    tootPayments: await db.select().from(tootPayments).where(eq(tootPayments.userId, userId))
  }
}

const deleteRequest = () => new Request(`${ORIGIN}/api/account/`, { method: 'DELETE' })

/** A Recording and a paid-for Toot (ADR 0010). */
async function fill({ id, cookie }: { id: string; cookie: string }) {
  await api.put('recordings', R1, uploadBody(recordingMetadata(R1), wav()), { cookie })
  await startTootPayment(testDb(), id, T1, 'twinkle', 'dev_test', TOOT_PRICE)
  await markTootPaid(testDb(), id, T1, 'dev_test')
  await api.put('toots', T1, uploadBody(tootMetadata(T1), wav()), { cookie })
}

describe('PATCH /api/account/', () => {
  it('turns Farty news by email off and on', async () => {
    const a = await signUp('A')
    const marketingEmail = async () => (await rowsOf(a.id)).users[0].marketingEmail
    expect(await marketingEmail()).toBe(true)

    const off = await api.patchAccount({ marketingEmail: false }, a)
    expect(off.status).toBe(200)
    expect(await off.json()).toEqual({ marketingEmail: false })
    expect(await marketingEmail()).toBe(false)

    await api.patchAccount({ marketingEmail: true }, a)
    expect(await marketingEmail()).toBe(true)
  })

  it('refuses anything but a true or false (400)', async () => {
    const a = await signUp('A')

    const responses = await Promise.all(
      [{ marketingEmail: 'no' }, {}, null, [false]].map(body => api.patchAccount(body, a))
    )

    expect(responses.map(response => response.status)).toEqual([400, 400, 400, 400])
    expect((await rowsOf(a.id)).users[0].marketingEmail).toBe(true)
  })

  it('refuses a change that names another account (409), and changes nothing', async () => {
    const a = await signUp('A')
    const b = await signUp('B')

    // A page still showing B, after A signed in in another tab.
    const refused = await api.patchAccount({ marketingEmail: false }, { ...a, library: b.id })

    expect(refused.status).toBe(409)
    expect(await refused.json()).toEqual({ error: 'wrong_account' })
    expect((await rowsOf(a.id)).users[0].marketingEmail).toBe(true)
    expect((await rowsOf(b.id)).users[0].marketingEmail).toBe(true)
    const own = await api.patchAccount({ marketingEmail: false }, { ...a, library: a.id })
    expect(own.status).toBe(200)
    expect((await rowsOf(a.id)).users[0].marketingEmail).toBe(false)
  })
})

describe('DELETE /api/account/', () => {
  it('deletes the user’s audio, then their row with their sessions, Recordings, Toots and payments', async () => {
    const a = await signUp('A')
    const b = await signUp('B')
    await fill(a)
    await fill(b)
    await api.delete('recordings', R1, a)
    const bKeys = await bucketKeys(`users/${b.id}/`)

    const response = await api.deleteAccount(a)

    expect(response.status).toBe(204)
    expect(await rowsOf(a.id)).toEqual({
      users: [],
      sessions: [],
      recordings: [],
      toots: [],
      tootPayments: []
    })
    expect(await bucketKeys(`users/${a.id}/`)).toEqual([])
    // Signed out everywhere: the session went with the user.
    expect((await api.library(a)).status).toBe(401)
    // Nobody else's account is touched.
    const others = await rowsOf(b.id)
    expect([others.users.length, others.sessions.length]).toEqual([1, 1])
    expect([others.recordings.length, others.toots.length]).toEqual([1, 1])
    expect(others.tootPayments).toHaveLength(1)
    expect(bKeys).toHaveLength(2)
    expect(await bucketKeys(`users/${b.id}/`)).toEqual(bKeys)
  })

  it('refuses a delete that names another account (409), and deletes nothing', async () => {
    const a = await signUp('A')
    const b = await signUp('B')
    await fill(a)
    await fill(b)
    const keys = await bucketKeys()
    const before = [await rowsOf(a.id), await rowsOf(b.id)]

    // A page still showing B, after A signed in in another tab.
    const refused = await api.deleteAccount({ ...a, library: b.id })

    expect(refused.status).toBe(409)
    expect(await refused.json()).toEqual({ error: 'wrong_account' })
    expect(await bucketKeys()).toEqual(keys)
    expect(keys).toHaveLength(4)
    expect([await rowsOf(a.id), await rowsOf(b.id)]).toEqual(before)
    expect((await api.deleteAccount({ ...a, library: a.id })).status).toBe(204)
    expect(await rowsOf(a.id)).toEqual({
      users: [],
      sessions: [],
      recordings: [],
      toots: [],
      tootPayments: []
    })
  })

  it('deletes the audio first, so a failure leaves an account to try again with', async () => {
    const a = await signUp('A')
    await fill(a)
    const failing = {
      list: (options: R2ListOptions) => env.MEDIA.list(options),
      delete: () => Promise.reject(new Error('R2 is down'))
    } as unknown as R2Bucket

    await expect(
      deleteAccount({ db: testDb(), media: failing }, { id: a.id }, deleteRequest())
    ).rejects.toThrow()

    expect((await rowsOf(a.id)).users).toHaveLength(1)
    expect((await api.deleteAccount(a)).status).toBe(204)
    expect(await bucketKeys()).toEqual([])
  })

  it('deletes a WAV an upload in flight wrote while the account was being deleted', async () => {
    const a = await signUp('A')
    await fill(a)
    const late = `users/${a.id}/recordings/late.wav`
    let written = false
    // R2 as an upload that passed its session check before the delete writes to it: its WAV
    // lands once the first sweep has found nothing left.
    const racing = {
      list: async (options: R2ListOptions) => {
        const page = await env.MEDIA.list(options)
        if (page.objects.length === 0 && !written) {
          written = true
          await env.MEDIA.put(late, wav())
        }
        return page
      },
      delete: (keys: string[]) => env.MEDIA.delete(keys)
    } as unknown as R2Bucket

    await deleteAccount({ db: testDb(), media: racing }, { id: a.id }, deleteRequest())

    expect(written).toBe(true)
    expect(await bucketKeys()).toEqual([])
  })

  it('deletes the sign-in codes waiting for the user’s email, by its lowercase', async () => {
    const a = await signUp('A')
    await signUp('B')
    const now = new Date()
    const code = (identifier: string) => ({
      id: identifier,
      identifier,
      value: 'hash:0',
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now
    })
    // Sign-in names a code's row by the lowercased email; signUp's are `A@example.test`.
    await testDb()
      .insert(verification)
      .values([code('sign-in-otp-a@example.test'), code('sign-in-otp-b@example.test')])

    expect((await api.deleteAccount(a)).status).toBe(204)

    const left = await testDb().select({ identifier: verification.identifier }).from(verification)
    expect(left).toEqual([{ identifier: 'sign-in-otp-b@example.test' }])
  })

  it('answers a signed-out request with 401 and deletes nothing', async () => {
    const a = await signUp('A')
    await fill(a)

    expect((await api.deleteAccount({})).status).toBe(401)
    expect((await rowsOf(a.id)).users).toHaveLength(1)
    expect(await bucketKeys()).toHaveLength(2)
  })
})
