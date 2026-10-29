import { and, eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { toots } from '@/db/schema'
import {
  api,
  bucketKeys,
  deletedAgo,
  library,
  nextD1Millisecond,
  R1,
  R2,
  rowsOf,
  signUp,
  T1,
  testDb,
  upload
} from '@/test-support/library-api'

vi.mock('@/server/toot-payments', async original =>
  (await import('@/test-support/free-payments')).freeTootPayments(original)
)

const OLD = '44444444-4444-4444-8444-444444444444'
const RECENT = '55555555-5555-4555-8555-555555555555'
const DAY = 24 * 60 * 60 * 1000

describe('deletes and GET /api/library/?since=', () => {
  it('leaves a tombstone that later reads list, deletes the WAV, and refuses the id again', async () => {
    const a = await signUp('A')
    await upload('recordings', R1, a.cookie)
    await upload('recordings', R2, a.cookie)
    await upload('toots', T1, a.cookie)
    await nextD1Millisecond()
    const first = await library(a.cookie)
    expect(first.recordings.map(r => r.id).sort()).toEqual([R1, R2])
    expect(first.deleted).toEqual({ recordings: [], toots: [] })
    await nextD1Millisecond()

    expect((await api.delete('recordings', R1, a)).status).toBe(204)
    expect((await api.delete('toots', T1, a)).status).toBe(204)

    const changes = await library(a.cookie, first.cursor)
    expect(changes.recordings).toEqual([])
    expect(changes.toots).toEqual([])
    expect(changes.deleted).toEqual({ recordings: [R1], toots: [T1] })
    expect(changes.cursor).toBeGreaterThanOrEqual(first.cursor)
    const everything = await library(a.cookie)
    expect(everything.recordings.map(r => r.id)).toEqual([R2])
    expect(everything.deleted).toEqual({ recordings: [R1], toots: [T1] })
    expect(await bucketKeys()).toEqual([`users/${a.id}/recordings/${R2}.wav`])
    expect((await api.audio('recordings', R1, a)).status).toBe(404)
    const [tombstone] = await testDb()
      .select()
      .from(toots)
      .where(and(eq(toots.userId, a.id), eq(toots.id, T1)))
    expect(tombstone.title).toBe('')
    expect((await upload('recordings', R1, a.cookie)).status).toBe(410)
    expect((await upload('toots', T1, a.cookie)).status).toBe(410)
    expect(await bucketKeys()).toEqual([`users/${a.id}/recordings/${R2}.wav`])
  })

  it('answers a repeated delete (204), and an unknown id with 404', async () => {
    const a = await signUp('A')
    await upload('recordings', R1, a.cookie)
    await api.delete('recordings', R1, a)

    expect((await api.delete('recordings', R1, a)).status).toBe(204)
    expect((await api.delete('recordings', R2, a)).status).toBe(404)
  })

  it('lists only what changed since the cursor', async () => {
    const a = await signUp('A')
    await upload('recordings', R1, a.cookie)
    await nextD1Millisecond()
    const first = await library(a.cookie)
    await nextD1Millisecond()

    const unchanged = await library(a.cookie, first.cursor)
    await upload('recordings', R2, a.cookie)
    const changed = await library(a.cookie, first.cursor)

    expect(unchanged.recordings).toEqual([])
    expect(changed.recordings.map(r => r.id)).toEqual([R2])
  })

  it('purges tombstones older than 30 days at the next delete, and keeps newer and others’', async () => {
    const a = await signUp('A')
    const b = await signUp('B')
    await deletedAgo('recordings', a.id, OLD, 31 * DAY)
    await deletedAgo('toots', a.id, OLD, 31 * DAY)
    await deletedAgo('recordings', a.id, RECENT, 29 * DAY)
    await deletedAgo('recordings', b.id, OLD, 31 * DAY)
    await upload('recordings', R1, a.cookie)

    expect((await api.delete('recordings', R1, a)).status).toBe(204)

    expect(await rowsOf('recordings')).toEqual([
      `${a.id} ${R1}`,
      `${a.id} ${RECENT}`,
      `${b.id} ${OLD}`
    ])
    expect(await rowsOf('toots')).toEqual([])
  })

  it('says a read is the whole library when its since is older than tombstones are kept', async () => {
    const a = await signUp('A')
    const { cursor, full } = await library(a.cookie)

    expect(full).toBe(true)
    expect((await library(a.cookie, cursor - 30 * DAY - 1000)).full).toBe(true)
    expect((await library(a.cookie, cursor - 30 * DAY + 60_000)).full).toBe(false)
    expect((await library(a.cookie, cursor)).full).toBe(false)
  })

  it('refuses a since that is not epoch milliseconds (400)', async () => {
    const a = await signUp('A')

    const responses = await Promise.all(
      ['-1', 'yesterday', '1e9', '9'.repeat(16)].map(since => api.library(a, since))
    )

    expect(responses.map(response => response.status)).toEqual([400, 400, 400, 400])
  })
})

describe('PATCH /api/toots/{id}/', () => {
  it('renames a Toot, and the last rename to arrive wins', async () => {
    const a = await signUp('A')
    await upload('toots', T1, a.cookie)
    const before = await library(a.cookie)
    await nextD1Millisecond()

    const first = await api.rename(T1, '  Bean Song  ', a)
    const second = await api.rename(T1, 'Gas Symphony', a)

    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ id: T1, title: 'Bean Song' })
    expect(second.status).toBe(200)
    const changes = await library(a.cookie, before.cursor)
    expect(changes.toots).toMatchObject([{ id: T1, title: 'Gas Symphony' }])
  })

  it('refuses an empty title (400), a deleted Toot (410) and an unknown one (404)', async () => {
    const a = await signUp('A')
    await upload('toots', T1, a.cookie)

    const empty = await api.rename(T1, '   ', a)
    const long = await api.rename(T1, 'x'.repeat(201), a)
    await api.delete('toots', T1, a)
    const deleted = await api.rename(T1, 'Too late', a)
    const unknown = await api.rename(R1, 'Nothing here', a)

    expect([empty.status, long.status, deleted.status, unknown.status]).toEqual([
      400, 400, 410, 404
    ])
  })
})
