import { env } from 'cloudflare:test'
import { and, eq, like } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import * as handleRoute from '@/app/api/handle/route'
import * as shareRecordingRoute from '@/app/api/share/recordings/[id]/route'
import * as shareTootRoute from '@/app/api/share/toots/[id]/route'
import { createDatabase } from '@/db/database'
import { profileReports, rateLimit, shares } from '@/db/schema'
import { songs } from '@/lib/catalog/songs.generated'
import { findProfile } from '@/server/profiles'
import {
  type As,
  api,
  giveFullAccess,
  ORIGIN,
  padTootMetadata,
  recordingMetadata,
  signUp,
  testDb,
  tootMetadata,
  uploadBody,
  wav
} from '@/test-support/library-api'

import * as reportRoute from './report/route'

// Profile pages (#319, ADR 0021) in workerd, with a real D1 and R2: `/@<handle>/` lists only the
// Recordings and Toots (#346) its user shares right now, newest first, and its Report keeps a row
// for Farty.

const R1 = '11111111-1111-4111-8111-111111111111'
const R2 = '22222222-2222-4222-8222-222222222222'
const R3 = '33333333-3333-4333-8333-333333333333'
const T1 = '44444444-4444-4444-8444-444444444444'
const T2 = '55555555-5555-4555-8555-555555555555'
const T3 = '66666666-6666-4666-8666-666666666666'
/** The Recordings `tootMetadata`'s and `padTootMetadata`'s Toots play, which aren't shared. */
const PLAYED = ['00000000-0000-0000-0000-000000000090', '00000000-0000-0000-0000-000000000084']

const twinkle = songs.find(song => song.id === 'twinkle')?.title

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

/** When the item `id` was shared: 9:`minute` on 1 November 2026. */
const sharedAt = (id: string, minute: number) =>
  testDb()
    .update(shares)
    .set({ createdAt: new Date(Date.UTC(2026, 10, 1, 9, minute)) })
    .where(eq(shares.itemId, id))

/**
 * Pays for the Toot `metadata.id` and saves it to `user`'s account, as Song Creator's Save does
 * (ADR 0010), then shares it unless `share` is false, at 9:`minute`.
 */
async function savedToot(
  user: { id: string; cookie: string },
  metadata: { id: string; songId: string | null },
  { minute = 0, share = true } = {}
) {
  const { id } = metadata
  await giveFullAccess(user.id)
  expect((await api.put('toots', id, uploadBody(metadata, wav()), user)).status).toBe(201)
  if (!share) return
  const shared = await shareTootRoute.PUT(
    request(`/api/share/toots/${id}/`, 'PUT', user),
    params({ id })
  )
  expect(shared.status).toBe(201)
  await sharedAt(id, minute)
}

const names = async (handle: string) =>
  (await findProfile(testDb(), handle))?.items.map(item => item.name) ?? null

/**
 * A report from the profile page, by the reporter at `ip`. `segment` is the path's first segment,
 * `@<handle>` as the page's link has it.
 */
const report = (
  handle: string,
  origin: string | null = ORIGIN,
  ip = '203.0.113.1',
  segment = `@${handle}`
) => {
  const headers = new Headers({ 'cf-connecting-ip': ip })
  if (origin !== null) headers.set('origin', origin)
  return reportRoute.POST(
    new Request(`${ORIGIN}/${segment}/report/`, { method: 'POST', headers }),
    params({ atHandle: segment })
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
    expect(newest.path).toBe('/@alice/r/recording-3/')
    expect(newest.sharedAt).toBe(Date.UTC(2026, 10, 1, 9, 2))
  })

  it('names a share from before links had names, so its row opens by name (#441)', async () => {
    await sharer('alice', [R1])
    await testDb().update(shares).set({ slug: null })
    const profile = await findProfile(testDb(), 'alice')
    expect(profile?.items.map(item => item.path)).toEqual(['/@alice/r/recording-1/'])
    const [row] = await testDb().select().from(shares)
    expect(row.slug).toBe('recording-1')
  })

  /** Each item's fields, which are all the page gets. */
  const ITEM_KEYS = [
    'detail',
    'farts',
    'kind',
    'length',
    'levels',
    'name',
    'path',
    'seconds',
    'sharedAt'
  ]

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

  it('lists the Toots its user shares with the Recordings, newest first, with nothing private (#346)', async () => {
    // R1 at 9:00, R2 at 9:01, R3 at 9:02.
    const alice = await sharer('alice', [R1, R2, R3])
    await savedToot(alice, tootMetadata(T1, { title: 'Twinkle for Mum' }), { minute: 3 })
    await savedToot(alice, padTootMetadata(T2), { minute: 1 })
    // T3's Song isn't in Farty any more.
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
    // R2 and the Sound Pad Toot, shared in the same minute, come by link id, as D1 orders them.
    expect(rows.slice(4)).toEqual(
      expect.arrayContaining([
        ['recordings', 'Recording 2', 'E3'],
        ['toots', 'Sound Pad', null]
      ])
    )
    for (const item of items) {
      const segment = item.kind === 'toots' ? 't' : 'r'
      expect(item.path).toMatch(new RegExp(`^/@alice/${segment}/[a-z0-9-]+/$`))
      // A Toot's row has a Recording's fields and no more: never its Arrangement or Performance.
      expect(Object.keys(item).sort()).toEqual(ITEM_KEYS)
    }

    // Nothing private: no Toot's or Recording's own id, no Recording a Toot plays, and not the
    // owner's id or email.
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

  it('lists Toots with no taken-down Recording, without loading a Sound Pad Toot’s taps (#346, #448)', async () => {
    const alice = await sharer('alice', [R1])
    const arrangement = { transposition: 0, recordingForPitch: { 64: R1 } }
    await savedToot(alice, tootMetadata(T1, { title: 'Song with R1', arrangement }), { minute: 2 })
    const performance = { recordings: [R1], taps: [[0, 0]] }
    await savedToot(alice, padTootMetadata(T2, { title: 'Pad with R1', performance }), {
      minute: 1
    })
    // Another user's take-down is not Alice's.
    const bob = await sharer('bob', [R1])
    await testDb()
      .update(shares)
      .set({ takenDownAt: new Date() })
      .where(and(eq(shares.userId, bob.id), eq(shares.itemId, R1)))
    // The SQL each lookup sends to D1.
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
    // A Performance whole, rather than only its Recordings: its taps can run to thousands. Only
    // the banner's one Toot is loaded whole, by its link, as its own page loads it (#448).
    const wholePerformances = () =>
      statements.filter(sql =>
        /"performance"/.test(
          sql.replaceAll(`json_extract("toots"."performance", '$.recordings')`, '')
        )
      )

    expect(await page()).toEqual(['Song with R1', 'Pad with R1', 'Recording 1'])
    const [banner, ...more] = wholePerformances()
    expect(more).toEqual([])
    expect(banner).toMatch(/"shares"\."slug" = \?/)

    // With Alice's own R1 taken down, the Toots that play it are dropped, still without their taps,
    // and with no Toot left there's no banner to load.
    statements = []
    await testDb()
      .update(shares)
      .set({ takenDownAt: new Date() })
      .where(and(eq(shares.userId, alice.id), eq(shares.itemId, R1)))
    expect(await page()).toEqual([])
    expect(statements.length).toBeGreaterThan(0)
    expect(wholePerformances()).toEqual([])
  })

  it('leaves out a Toot that was never shared, stopped, deleted or taken down (#346)', async () => {
    const alice = await sharer('alice', [])
    await savedToot(alice, tootMetadata(T1), { share: false })
    await savedToot(alice, tootMetadata(T2, { title: 'Stopped' }), { minute: 3 })
    await savedToot(alice, tootMetadata(T3, { title: 'Deleted' }), { minute: 2 })
    const T4 = '77777777-7777-4777-8777-777777777777'
    await savedToot(alice, tootMetadata(T4, { title: 'Taken down' }), { minute: 1 })
    expect(await names('alice')).toEqual(['Stopped', 'Deleted', 'Taken down'])

    const stopped = await shareTootRoute.DELETE(
      request(`/api/share/toots/${T2}/`, 'DELETE', alice),
      params({ id: T2 })
    )
    expect(stopped.status).toBe(204)
    expect((await api.delete('toots', T3, alice)).status).toBe(204)
    await testDb().update(shares).set({ takenDownAt: new Date() }).where(eq(shares.itemId, T4))
    expect(await names('alice')).toEqual([])
  })

  it('leaves out a Toot that plays a taken-down Recording, until it is back (#346)', async () => {
    const alice = await sharer('alice', [R1])
    // T1 plays R1 for one of its Song's pitches, T2 tapped R1 on the Sound Pad, and T3 plays R2.
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
    expect(await names('alice')).toEqual([
      'Song with R1',
      'Pad with R1',
      'Song with R2',
      'Recording 1'
    ])

    // Farty takes down R1's own link after a report.
    await testDb().update(shares).set({ takenDownAt: new Date() }).where(eq(shares.itemId, R1))
    expect(await names('alice')).toEqual(['Song with R2'])

    // Put back, R1 brings its Toots back with it.
    await testDb().update(shares).set({ takenDownAt: null }).where(eq(shares.itemId, R1))
    expect(await names('alice')).toEqual([
      'Song with R1',
      'Pad with R1',
      'Song with R2',
      'Recording 1'
    ])

    // Taken down again, then deleted: its take-down stays, so its Toots stay off the page.
    await testDb().update(shares).set({ takenDownAt: new Date() }).where(eq(shares.itemId, R1))
    expect((await api.delete('recordings', R1, alice)).status).toBe(204)
    expect(await names('alice')).toEqual(['Song with R2'])
  })

  it('gives each row its length and bars, and a Toot’s the farts it plays (#448)', async () => {
    // R1 at 9:00, R2 at 9:01.
    const alice = await sharer('alice', [R1, R2])
    const arrangement = { transposition: 0, recordingForPitch: { 52: R1, 55: R2 } }
    await savedToot(alice, tootMetadata(T1, { title: 'Song', arrangement, seconds: 18.4 }), {
      minute: 3
    })
    // R3 was never uploaded, so the row names only R2.
    const performance = {
      recordings: [R2, R3],
      taps: [
        [0, 0],
        [0.5, 1]
      ]
    }
    await savedToot(alice, padTootMetadata(T2, { title: 'Pad', performance, seconds: 61 }), {
      minute: 2
    })

    const row = async (name: string) =>
      (await findProfile(testDb(), 'alice'))?.items.find(item => item.name === name)
    expect(await row('Song')).toMatchObject({
      length: '0:18',
      seconds: 18.4,
      levels: [],
      farts: ['Recording 1', 'Recording 2']
    })
    expect(await row('Pad')).toMatchObject({ length: '1:01', seconds: 61, farts: ['Recording 2'] })
    // A Recording's length, bars and seconds are all what its link serves and its own page plays:
    // the whole take, which has no Trim. So its length is its seconds, never its shorter fart's.
    expect(await row('Recording 1')).toMatchObject({
      length: '0.1 s',
      seconds: 0.1,
      levels: [0, 0.5, 1],
      farts: []
    })

    // A deleted Recording is no longer named.
    expect((await api.delete('recordings', R2, alice)).status).toBe(204)
    expect((await row('Song'))?.farts).toEqual(['Recording 1'])
    expect((await row('Pad'))?.farts).toEqual([])
  })

  it('puts the newest Toot’s roll in its banner, with only the pitches its farts play (#448)', async () => {
    const alice = await sharer('alice', [R1])
    expect((await findProfile(testDb(), 'alice'))?.hero).toBeNull()

    const arrangement = { transposition: 0, recordingForPitch: { 60: R1 } }
    await savedToot(alice, tootMetadata(T1, { title: 'Older', arrangement }), { minute: 2 })
    await savedToot(alice, tootMetadata(T2, { title: 'Newest', arrangement }), { minute: 3 })
    const profile = await findProfile(testDb(), 'alice')
    const newest = profile?.items.find(item => item.name === 'Newest')
    expect(profile?.hero?.path).toBe(newest?.path)
    expect(Object.keys(profile?.hero ?? {}).sort()).toEqual([
      'catalogSong',
      'path',
      'played',
      'song'
    ])
    expect(profile?.hero?.played).toEqual([60])

    // Stopped, the next newest takes the banner; with none, there's no banner.
    for (const [id, next] of [
      [T2, 'Older'],
      [T1, null]
    ] as const) {
      const stopped = await shareTootRoute.DELETE(
        request(`/api/share/toots/${id}/`, 'DELETE', alice),
        params({ id })
      )
      expect(stopped.status).toBe(204)
      const after = await findProfile(testDb(), 'alice')
      expect(after?.hero?.path ?? null).toBe(
        next && (after?.items.find(item => item.name === next)?.path ?? 'missing')
      )
    }
  })

  it('is found by its Handle in any case, and is there with nothing shared', async () => {
    await sharer('alice', [])
    expect(await findProfile(testDb(), 'ALICE')).toEqual({ handle: 'alice', items: [], hero: null })
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
    // A path with no `@` is no one's page (#382).
    expect((await report('alice', ORIGIN, '203.0.113.1', 'alice')).status).toBe(404)
    expect((await report('alice', ORIGIN, '203.0.113.1', 'u')).status).toBe(404)
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
