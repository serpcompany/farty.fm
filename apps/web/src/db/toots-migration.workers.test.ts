import { applyD1Migrations, type D1Migration, env, reset } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

// Migration 0005 (#278, ADR 0017) rebuilds `toots` so a Toot can have no Song: `song_id` and
// `arrangement` may be null, beside a new `performance`. Its INSERT is edited by hand (the old
// table has no `performance`), so here it runs on a D1 that already holds Toots, as Staging's and
// Production's do, and every row comes through as it was.

const { DB, TEST_MIGRATIONS } = env as unknown as {
  DB: D1Database
  TEST_MIGRATIONS: D1Migration[]
}

const USER = 'user-a'
const T1 = '33333333-3333-4333-8333-333333333333'
const T2 = '44444444-4444-4444-8444-444444444444'
const T3 = '55555555-5555-4555-8555-555555555555'
const ARRANGEMENT = '{"transposition":-12,"recordingForPitch":{"60":"r"}}'

/** The D1 as it was before 0005, with a user, a live Toot and a tombstone. */
async function before0005() {
  await reset()
  const upTo = TEST_MIGRATIONS.findIndex(m => m.name.startsWith('0005_'))
  expect(upTo).toBe(5)
  await applyD1Migrations(DB, TEST_MIGRATIONS.slice(0, upTo))
  await DB.batch([
    DB.prepare(
      `insert into user (id, name, email, created_at, updated_at)
       values (?1, '', 'a@example.com', 1, 1)`
    ).bind(USER),
    DB.prepare(
      `insert into toots (user_id, id, title, song_id, created_at, seconds, arrangement,
         audio_bytes, updated_at, deleted_at)
       values (?1, ?2, 'Twinkle', 'twinkle', 10, 1.5, ?3, 100, 20, null),
              (?1, ?4, '', 'mary', 11, 2.5, ?3, 200, 21, 30)`
    ).bind(USER, T1, ARRANGEMENT, T2)
  ])
}

const rows = async () =>
  (await DB.prepare('select * from toots order by id').all()).results as Record<string, unknown>[]

describe('migration 0005_toot_performance', () => {
  it('keeps every Toot, live or deleted, as it was, with no Performance', async () => {
    await before0005()
    const was = await rows()
    await applyD1Migrations(DB, TEST_MIGRATIONS)
    expect(await rows()).toEqual(was.map(row => ({ ...row, performance: null })))
    const index = await DB.prepare(
      "select name from sqlite_master where type = 'index' and tbl_name = 'toots'"
    ).all()
    expect(index.results).toContainEqual({ name: 'toots_user_id_updated_at_idx' })
  })

  it('then keeps a Toot of a Song or of a Performance, never both or neither', async () => {
    await before0005()
    await applyD1Migrations(DB, TEST_MIGRATIONS)
    const insert = (
      songId: string | null,
      arrangement: string | null,
      performance: string | null
    ) =>
      DB.prepare(
        `insert into toots (user_id, id, title, song_id, created_at, seconds, arrangement,
           performance, audio_bytes, updated_at)
         values (?1, ?2, 'Sound Pad', ?3, 12, 1, ?4, ?5, 100, 22)`
      )
        .bind(USER, T3, songId, arrangement, performance)
        .run()
    const performance = '{"recordings":["r"],"taps":[[0,0]]}'
    for (const [songId, arrangement, played] of [
      ['twinkle', ARRANGEMENT, performance],
      ['twinkle', null, null],
      [null, ARRANGEMENT, null],
      [null, null, null],
      [null, ARRANGEMENT, performance]
    ] as const) {
      await expect(insert(songId, arrangement, played)).rejects.toThrow(/CHECK constraint failed/)
    }
    await insert(null, null, performance)
    expect((await rows()).map(row => row.id)).toEqual([T1, T2, T3])
  })
})
