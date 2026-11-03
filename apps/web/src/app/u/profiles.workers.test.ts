import { eq, like } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import * as handleRoute from '@/app/api/handle/route'
import * as shareRecordingRoute from '@/app/api/share/recordings/[id]/route'
import { profileReports, rateLimit, shares } from '@/db/schema'
import { findProfile } from '@/server/profiles'
import {
  type As,
  api,
  ORIGIN,
  recordingMetadata,
  signUp,
  testDb,
  uploadBody,
  wav
} from '@/test-support/library-api'

import * as reportRoute from './[handle]/report/route'

// Profile pages (#319, ADR 0021) in workerd, with a real D1 and R2: `/u/<handle>/` lists only the
// Recordings its user shares right now, newest first, and its Report keeps a row for Farty.

const R1 = '11111111-1111-4111-8111-111111111111'
const R2 = '22222222-2222-4222-8222-222222222222'
const R3 = '33333333-3333-4333-8333-333333333333'

const params = <P>(value: P) => ({ params: Promise.resolve(value) })

function request(path: string, method: string, as: As, body?: unknown) {
  const headers = new Headers()
  if (as.cookie) headers.set('cookie', as.cookie)
  if (method !== 'GET') headers.set('origin', ORIGIN)
  if (body !== undefined) headers.set('content-type', 'application/json')
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  })
}

/** A user with the Handle `name`, and Recordings `ids` uploaded and shared in that order. */
async function sharer(name: string, ids: string[]) {
  const user = await signUp(name)
  const picked = await handleRoute.PUT(
    request('/api/handle/', 'PUT', user, { handle: name }),
    params({})
  )
  expect(picked.status).toBe(201)
  for (const [i, id] of ids.entries()) {
    const metadata = recordingMetadata(id, { number: i + 1 })
    const uploaded = await api.put('recordings', id, uploadBody(metadata, wav()), user)
    expect(uploaded.status).toBe(201)
    const shared = await shareRecordingRoute.PUT(
      request(`/api/share/recordings/${id}/`, 'PUT', user),
      params({ id })
    )
    expect(shared.status).toBe(201)
    // Minutes apart, as the page lists them by when each was shared.
    await testDb()
      .update(shares)
      .set({ createdAt: new Date(Date.UTC(2026, 10, 1, 9, i)) })
      .where(eq(shares.itemId, id))
  }
  return user
}

const names = async (handle: string) =>
  (await findProfile(testDb(), handle))?.items.map(item => item.name) ?? null

/** A report from the profile page, by the reporter at `ip`. */
const report = (handle: string, origin: string | null = ORIGIN, ip = '203.0.113.1') => {
  const headers = new Headers({ 'cf-connecting-ip': ip })
  if (origin !== null) headers.set('origin', origin)
  return reportRoute.POST(
    new Request(`${ORIGIN}/u/${handle}/report/`, { method: 'POST', headers }),
    params({ handle })
  )
}

describe('A profile page', () => {
  it('lists the Recordings its user shares, newest first, with nothing private', async () => {
    await sharer('alice', [R1, R2, R3])
    const profile = await findProfile(testDb(), 'alice')
    expect(profile?.handle).toBe('alice')
    expect(profile?.items.map(item => item.name)).toEqual([
      'Recording 3',
      'Recording 2',
      'Recording 1'
    ])
    const [newest] = profile?.items ?? []
    expect(Object.keys(newest).sort()).toEqual(['name', 'note', 'shareId', 'sharedAt'])
    expect(newest.note).toBe('E3')
    expect(newest.shareId).not.toBe(R3)
    expect(newest.sharedAt).toBe(Date.UTC(2026, 10, 1, 9, 2))
  })

  it('leaves out what was stopped, taken down or deleted, and what others share', async () => {
    const alice = await sharer('alice', [R1, R2, R3])
    await sharer('bob', [R1])
    expect(
      (
        await shareRecordingRoute.DELETE(
          request(`/api/share/recordings/${R1}/`, 'DELETE', alice),
          params({ id: R1 })
        )
      ).status
    ).toBe(204)
    await testDb().update(shares).set({ takenDownAt: new Date() }).where(eq(shares.itemId, R2))
    expect((await api.delete('recordings', R3, alice)).status).toBe(204)
    expect(await names('alice')).toEqual([])
    expect(await names('bob')).toEqual(['Recording 1'])
  })

  it('lists no shared Toot yet, only Recordings (#317)', async () => {
    const alice = await sharer('alice', [R1])
    await testDb().insert(shares).values({
      id: 'abcdefghjkmn',
      userId: alice.id,
      kind: 'toots',
      itemId: R2,
      createdAt: new Date()
    })
    expect(await names('alice')).toEqual(['Recording 1'])
  })

  it('is found by its Handle in any case, and is there with nothing shared', async () => {
    await sharer('alice', [])
    expect(await findProfile(testDb(), 'ALICE')).toEqual({ handle: 'alice', items: [] })
  })

  it('is not found for a Handle no one has, one that could be no one’s, or a deleted account', async () => {
    const alice = await sharer('alice', [R1])
    for (const handle of ['bob', 'ab', 'a-b', 'a'.repeat(21), '..']) {
      expect(await findProfile(testDb(), handle)).toBeNull()
    }
    expect((await api.deleteAccount(alice)).status).toBe(204)
    expect(await findProfile(testDb(), 'alice')).toBeNull()
  })
})

describe('Reporting a profile page', () => {
  it('keeps a row naming the user, not the reporter', async () => {
    const alice = await sharer('alice', [])
    expect((await report('alice')).status).toBe(204)
    expect(await testDb().select().from(profileReports)).toEqual([
      { id: expect.any(String), userId: alice.id, createdAt: expect.any(Date) }
    ])
    const keys = (await testDb().select({ key: rateLimit.key }).from(rateLimit)).map(r => r.key)
    expect(keys.join(' ')).not.toContain('203.0.113')
  })

  it('is refused from another site, or with no origin, and for a Handle no one has', async () => {
    await sharer('alice', [])
    expect((await report('alice', 'https://evil.example')).status).toBe(403)
    expect((await report('alice', null)).status).toBe(403)
    expect((await report('bob')).status).toBe(404)
    expect(await testDb().select().from(profileReports)).toEqual([])
  })

  it('keeps a few a day per page, and answers 429 past them', async () => {
    await sharer('alice', [])
    for (let i = 0; i < 5; i++) {
      expect((await report('alice', ORIGIN, `203.0.113.${i}`)).status).toBe(204)
    }
    const refused = await report('alice', ORIGIN, '203.0.113.9')
    expect(refused.status).toBe(429)
    expect(await refused.json()).toEqual({ error: 'too_many_reports' })
    expect(await testDb().select().from(profileReports)).toHaveLength(5)
  })

  it('spends the same reporter and site slots as a shared Recording’s Report', async () => {
    await sharer('alice', [])
    expect((await report('alice')).status).toBe(204)
    const rows = await testDb()
      .select({ key: rateLimit.key, count: rateLimit.count })
      .from(rateLimit)
      .where(like(rateLimit.key, 'share%'))
    expect(rows).toEqual(
      expect.arrayContaining([
        { key: expect.stringMatching(/^share-reporter\|[0-9a-f]{64}$/), count: 1 },
        { key: 'share_report', count: 1 }
      ])
    )
  })

  it('goes with the account', async () => {
    const alice = await sharer('alice', [])
    await report('alice')
    await api.deleteAccount(alice)
    expect(await testDb().select().from(profileReports)).toEqual([])
  })
})
