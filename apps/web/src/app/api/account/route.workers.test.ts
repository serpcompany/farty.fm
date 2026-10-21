import { env } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { recordings, session, toots, user, verification } from '@/db/schema'
import { deleteAccount } from '@/server/library'
import {
  api,
  bucketKeys,
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
    toots: await db.select().from(toots).where(eq(toots.userId, userId))
  }
}

async function fill(cookie: string) {
  await api.put('recordings', R1, uploadBody(recordingMetadata(R1), wav()), { cookie })
  await api.put('toots', T1, uploadBody(tootMetadata(T1), wav()), { cookie })
}

describe('PATCH /api/account/', () => {
  it('turns Pedos news by email off and on', async () => {
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
})

describe('DELETE /api/account/', () => {
  it('deletes the user’s audio, then their row with their sessions, Recordings and Toots', async () => {
    const a = await signUp('A')
    const b = await signUp('B')
    await fill(a.cookie)
    await fill(b.cookie)
    await api.delete('recordings', R1, a)
    const bKeys = await bucketKeys(`users/${b.id}/`)

    const response = await api.deleteAccount(a)

    expect(response.status).toBe(204)
    expect(await rowsOf(a.id)).toEqual({ users: [], sessions: [], recordings: [], toots: [] })
    expect(await bucketKeys(`users/${a.id}/`)).toEqual([])
    // Signed out everywhere: the session went with the user.
    expect((await api.library(a)).status).toBe(401)
    // Nobody else's account is touched.
    const others = await rowsOf(b.id)
    expect([others.users.length, others.sessions.length]).toEqual([1, 1])
    expect([others.recordings.length, others.toots.length]).toEqual([1, 1])
    expect(bKeys).toHaveLength(2)
    expect(await bucketKeys(`users/${b.id}/`)).toEqual(bKeys)
  })

  it('deletes the audio first, so a failure leaves an account to try again with', async () => {
    const a = await signUp('A')
    await fill(a.cookie)
    const failing = {
      list: (options: R2ListOptions) => env.MEDIA.list(options),
      delete: () => Promise.reject(new Error('R2 is down'))
    } as unknown as R2Bucket

    await expect(deleteAccount({ db: testDb(), media: failing }, { id: a.id })).rejects.toThrow()

    expect((await rowsOf(a.id)).users).toHaveLength(1)
    expect((await api.deleteAccount(a)).status).toBe(204)
    expect(await bucketKeys()).toEqual([])
  })

  it('deletes a WAV an upload in flight wrote while the account was being deleted', async () => {
    const a = await signUp('A')
    await fill(a.cookie)
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

    await deleteAccount({ db: testDb(), media: racing }, { id: a.id })

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
    await fill(a.cookie)

    expect((await api.deleteAccount({})).status).toBe(401)
    expect((await rowsOf(a.id)).users).toHaveLength(1)
    expect(await bucketKeys()).toHaveLength(2)
  })
})
