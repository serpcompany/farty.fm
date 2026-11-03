import { env } from 'cloudflare:test'
import { and, eq, like } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { createDatabase } from '@/db/database'
import { profileReports, rateLimit, shares } from '@/db/schema'
import { findProfile } from '@/server/profiles'
import {
  api,
  ORIGIN,
  padTootMetadata,
  params,
  R1,
  R2,
  recordingMetadata,
  testDb,
  tootMetadata,
  uploadBody,
  wav
} from '@/test-support/library-api'
import { payFor, share, shareUrl, withHandle } from '@/test-support/sharing-api'
import { songs } from '@/test-support/songs.generated'

import * as reportRoute from './[handle]/report/route'

const R3 = '33333333-3333-4333-8333-333333333333'
const T1 = '44444444-4444-4444-8444-444444444444'
const T2 = '55555555-5555-4555-8555-555555555555'
const T3 = '66666666-6666-4666-8666-666666666666'
const PLAYED = ['00000000-0000-0000-0000-000000000090', '00000000-0000-0000-0000-000000000084']
const ITEM_KEYS = ['detail', 'kind', 'name', 'path', 'shareId', 'sharedAt']

const twinkle = songs.find(song => song.id === 'twinkle')?.title

const sharedAt = (id: string, minute: number) =>
  testDb()
    .update(shares)
    .set({ createdAt: new Date(Date.UTC(2026, 10, 1, 9, minute)) })
    .where(eq(shares.itemId, id))

async function sharer(name: string, ids: string[]) {
  const user = await withHandle(name)
  for (const [i, id] of ids.entries()) {
    const metadata = recordingMetadata(id, { number: i + 1 })
    expect((await api.put('recordings', id, uploadBody(metadata, wav()), user)).status).toBe(201)
    await shareUrl(id, user)
    await sharedAt(id, i)
  }
  return user
}

async function savedToot(
  user: { id: string; cookie: string },
  metadata: { id: string; songId: string | null },
  { minute = 0, share: shared = true } = {}
) {
  const { id, songId } = metadata
  await payFor(user, id, songId)
  expect((await api.put('toots', id, uploadBody(metadata, wav()), user)).status).toBe(201)
  if (!shared) return
  await shareUrl(id, user, 'toots')
  await sharedAt(id, minute)
}

const names = async (handle: string) =>
  (await findProfile(testDb(), handle))?.items.map(item => item.name) ?? null

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
    expect(Object.keys(newest).sort()).toEqual(ITEM_KEYS)
    expect(newest.kind).toBe('recordings')
    expect(newest.detail).toBe('E3')
    expect(newest.shareId).not.toBe(R3)
    expect(newest.path).toBe(`/u/alice/r/${newest.shareId}/`)
    expect(newest.sharedAt).toBe(Date.UTC(2026, 10, 1, 9, 2))
  })

  it('leaves out what was stopped, taken down or deleted, and what others share', async () => {
    const alice = await sharer('alice', [R1, R2, R3])
    await sharer('bob', [R1])
    expect((await share.stop(R1, alice)).status).toBe(204)
    await testDb().update(shares).set({ takenDownAt: new Date() }).where(eq(shares.itemId, R2))
    expect((await api.delete('recordings', R3, alice)).status).toBe(204)
    expect(await names('alice')).toEqual([])
    expect(await names('bob')).toEqual(['Recording 1'])
  })

  it('lists the Toots its user shares with the Recordings, newest first, with nothing private (#346)', async () => {
    const alice = await sharer('alice', [R1, R2, R3])
    await savedToot(alice, tootMetadata(T1, { title: 'Twinkle for Mum' }), { minute: 3 })
    await savedToot(alice, padTootMetadata(T2), { minute: 1 })
    await savedToot(alice, tootMetadata(T3, { songId: 'gone', title: 'Old' }), { minute: 5 })
    await sharedAt(R1, 4)

    const profile = await findProfile(testDb(), 'alice')
    const items = profile?.items ?? []
    expect(items).toHaveLength(6)
    const rows = items.map(item => [item.kind, item.name, item.detail])
    expect(rows.slice(0, 4)).toEqual([
      ['toots', 'Old', null],
      ['recordings', 'Recording 1', 'E3'],
      ['toots', 'Twinkle for Mum', twinkle],
      ['recordings', 'Recording 3', 'E3']
    ])
    expect(rows.slice(4)).toEqual(
      expect.arrayContaining([
        ['recordings', 'Recording 2', 'E3'],
        ['toots', 'Sound Pad', 'Sound Pad']
      ])
    )
    expect(items[4].shareId > items[5].shareId).toBe(true)
    for (const item of items) {
      const segment = item.kind === 'toots' ? 't' : 'r'
      expect(item.path).toBe(`/u/alice/${segment}/${item.shareId}/`)
      expect(Object.keys(item).sort()).toEqual(ITEM_KEYS)
    }

    const page = JSON.stringify(profile)
    for (const secret of [T1, T2, T3, R1, R2, R3, ...PLAYED, alice.id, 'alice@example.test']) {
      expect(page).not.toContain(secret)
    }
  })

  it('leaves out the Toots others share (#346)', async () => {
    const alice = await sharer('alice', [])
    await savedToot(alice, tootMetadata(T1, { title: 'Alice’s' }), { minute: 1 })
    const bob = await sharer('bob', [])
    await savedToot(bob, tootMetadata(T2, { title: 'Bob’s' }), { minute: 2 })
    expect(await names('alice')).toEqual(['Alice’s'])
    expect(await names('bob')).toEqual(['Bob’s'])
  })

  it('lists Toots with no taken-down Recording, without loading what they play (#346)', async () => {
    const alice = await sharer('alice', [R1])
    const arrangement = { transposition: 0, recordingForPitch: { 64: R1 } }
    await savedToot(alice, tootMetadata(T1, { title: 'Song with R1', arrangement }), { minute: 2 })
    const performance = { recordings: [R1], taps: [[0, 0]] }
    await savedToot(alice, padTootMetadata(T2, { title: 'Pad with R1', performance }), {
      minute: 1
    })
    const bob = await sharer('bob', [R1])
    await testDb()
      .update(shares)
      .set({ takenDownAt: new Date() })
      .where(and(eq(shares.userId, bob.id), eq(shares.itemId, R1)))
    let statements: string[] = []
    const watched = new Proxy(env.DB, {
      get(target, key) {
        if (key === 'prepare') {
          return (sql: string) => {
            statements.push(sql)
            return target.prepare(sql)
          }
        }
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      }
    })
    const page = async () =>
      (await findProfile(createDatabase(watched), 'alice'))?.items.map(item => item.name)
    const loadsTaps = () => /"arrangement"|"performance"/.test(statements.join('\n'))

    expect(await page()).toEqual(['Song with R1', 'Pad with R1', 'Recording 1'])
    expect(loadsTaps()).toBe(false)

    statements = []
    await testDb()
      .update(shares)
      .set({ takenDownAt: new Date() })
      .where(and(eq(shares.userId, alice.id), eq(shares.itemId, R1)))
    expect(await page()).toEqual([])
    expect(loadsTaps()).toBe(true)
  })

  it('leaves out a Toot that was never shared, stopped, deleted or taken down (#346)', async () => {
    const alice = await sharer('alice', [])
    await savedToot(alice, tootMetadata(T1), { share: false })
    await savedToot(alice, tootMetadata(T2, { title: 'Stopped' }), { minute: 3 })
    await savedToot(alice, tootMetadata(T3, { title: 'Deleted' }), { minute: 2 })
    const T4 = '77777777-7777-4777-8777-777777777777'
    await savedToot(alice, tootMetadata(T4, { title: 'Taken down' }), { minute: 1 })
    expect(await names('alice')).toEqual(['Stopped', 'Deleted', 'Taken down'])

    expect((await share.stop(T2, alice, 'toots')).status).toBe(204)
    expect((await api.delete('toots', T3, alice)).status).toBe(204)
    await testDb().update(shares).set({ takenDownAt: new Date() }).where(eq(shares.itemId, T4))
    expect(await names('alice')).toEqual([])
  })

  it('leaves out a Toot that plays a taken-down Recording, until it is back (#346)', async () => {
    const alice = await sharer('alice', [R1])
    const arrangement = { transposition: 0, recordingForPitch: { 60: R2, 64: R1 } }
    await savedToot(alice, tootMetadata(T1, { title: 'Song with R1', arrangement }), { minute: 3 })
    const performance = { recordings: [R1], taps: [[0, 0]] }
    await savedToot(alice, padTootMetadata(T2, { title: 'Pad with R1', performance }), {
      minute: 2
    })
    const others = { transposition: 0, recordingForPitch: { 60: R2 } }
    await savedToot(alice, tootMetadata(T3, { title: 'Song with R2', arrangement: others }), {
      minute: 1
    })
    const everything = ['Song with R1', 'Pad with R1', 'Song with R2', 'Recording 1']
    expect(await names('alice')).toEqual(everything)

    await testDb().update(shares).set({ takenDownAt: new Date() }).where(eq(shares.itemId, R1))
    expect(await names('alice')).toEqual(['Song with R2'])

    await testDb().update(shares).set({ takenDownAt: null }).where(eq(shares.itemId, R1))
    expect(await names('alice')).toEqual(everything)

    await testDb().update(shares).set({ takenDownAt: new Date() }).where(eq(shares.itemId, R1))
    expect((await api.delete('recordings', R1, alice)).status).toBe(204)
    expect(await names('alice')).toEqual(['Song with R2'])
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
