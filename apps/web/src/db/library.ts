import { and, count, eq, gte, isNotNull, isNull, lt, sql } from 'drizzle-orm'

import type { Performance } from '../lib/performance'
import type { Analysis, Trim } from '../lib/recordings'
import type { TootArrangement } from '../lib/toot'
import type { Database } from './database'
import { recordings, toots, user, verification } from './schema'

// A user's library in D1: their Recordings and Toots, and their tombstones. Every query here takes
// the session's user id and filters on it, so one user never reads or changes another's rows.

/** A user's Recordings or their Toots, by the name of their table and their prefix in R2. */
export type Kind = 'recordings' | 'toots'

const tables = { recordings, toots }

/**
 * Now, in epoch milliseconds, by D1's own clock. Every `updated_at` and `deleted_at` is written
 * with it, and D1 runs one statement at a time, so a row changed after a library read always has
 * an `updated_at` at or after that read's `cursor` (`libraryChanges`).
 */
const d1Now = sql<number>`cast(unixepoch('subsec') * 1000 as integer)`

/** A Recording to keep, as the browser uploads it. */
export type NewRecording = {
  id: string
  number: number
  createdAt: number
  seconds: number
  sampleRate: number
  waveform: number[]
  analysis: Analysis | null
  /** The Placed Pitch, or null when left out (ADR 0015). */
  placedPitch: number | null
  /** The Trim, or null when untrimmed (ADR 0019). */
  trim: Trim | null
  audioBytes: number
}

/**
 * A Toot to keep, as the browser uploads it: of a Song, with its Arrangement, or from the Sound
 * Pad, with its Performance and no Song (ADR 0017).
 */
export type NewToot = TootFields & { audioBytes: number }

/** A Toot's fields as its upload's metadata carries them: all of `NewToot` but its audio's size. */
export type TootFields = {
  id: string
  title: string
  createdAt: number
  seconds: number
} & (
  | { songId: string; arrangement: TootArrangement; performance: null }
  | { songId: null; arrangement: null; performance: Performance }
)

const json = (value: object | null) => (value === null ? null : JSON.stringify(value))

/** Whether the user has this row, and whether it is a tombstone. */
export type ItemStatus = 'live' | 'deleted' | null

const whereItem = (kind: Kind, userId: string, id: string) =>
  and(eq(tables[kind].userId, userId), eq(tables[kind].id, id))

function itemStatusQuery(db: Database, kind: Kind, userId: string, id: string) {
  const table = tables[kind]
  return db
    .select({ deletedAt: table.deletedAt })
    .from(table)
    .where(whereItem(kind, userId, id))
}

const statusOf = (rows: { deletedAt: Date | null }[]): ItemStatus =>
  rows.length === 0 ? null : rows[0].deletedAt ? 'deleted' : 'live'

/** The row's status, and how many live rows of this kind the user has. */
export async function uploadState(
  db: Database,
  kind: Kind,
  userId: string,
  id: string
): Promise<{ status: ItemStatus; live: number }> {
  const table = tables[kind]
  const [status, [{ live }]] = await db.batch([
    itemStatusQuery(db, kind, userId, id),
    db
      .select({ live: count() })
      .from(table)
      .where(and(eq(table.userId, userId), isNull(table.deletedAt)))
  ])
  return { status: statusOf(status), live }
}

export async function itemStatus(
  db: Database,
  kind: Kind,
  userId: string,
  id: string
): Promise<ItemStatus> {
  return statusOf(await itemStatusQuery(db, kind, userId, id))
}

/**
 * Adds the Recording unless the user already has a row with its id or already has `limit` live
 * Recordings. One statement, so two uploads at once can't both pass the limit. True if added.
 */
export async function insertRecording(
  db: Database,
  userId: string,
  r: NewRecording,
  limit: number
): Promise<boolean> {
  const analysis = r.analysis === null ? null : JSON.stringify(r.analysis)
  const added = await db.all(sql`
    insert into recordings (user_id, id, number, created_at, seconds, sample_rate, waveform,
      analysis, placed_pitch, trim_start_seconds, trim_end_seconds, audio_bytes, updated_at)
    select ${userId}, ${r.id}, ${r.number}, ${r.createdAt}, ${r.seconds}, ${r.sampleRate},
      ${JSON.stringify(r.waveform)}, ${analysis}, ${r.placedPitch},
      ${r.trim?.startSeconds ?? null}, ${r.trim?.endSeconds ?? null}, ${r.audioBytes}, ${d1Now}
    where (select count(*) from recordings where user_id = ${userId} and deleted_at is null)
      < ${limit}
    on conflict do nothing
    returning id`)
  return added.length === 1
}

/** The insert of `insertToot`, and with `paid`, only while the Toot's payment is paid and unused. */
function tootInsert(db: Database, userId: string, t: NewToot, limit: number, paid: boolean) {
  const payment = paid
    ? sql`and exists (select 1 from toot_payments where user_id = ${userId}
        and toot_id = ${t.id} and paid_at is not null and saved_at is null)`
    : sql``
  return db.all(sql`
    insert into toots (user_id, id, title, song_id, created_at, seconds, arrangement,
      performance, audio_bytes, updated_at)
    select ${userId}, ${t.id}, ${t.title}, ${t.songId}, ${t.createdAt}, ${t.seconds},
      ${json(t.arrangement)}, ${json(t.performance)}, ${t.audioBytes}, ${d1Now}
    where (select count(*) from toots where user_id = ${userId} and deleted_at is null)
      < ${limit} ${payment}
    on conflict do nothing
    returning id`)
}

/** Adds the Toot, as `insertRecording` adds a Recording. True if added. */
export async function insertToot(
  db: Database,
  userId: string,
  t: NewToot,
  limit: number
): Promise<boolean> {
  return (await tootInsert(db, userId, t, limit, false)).length === 1
}

/**
 * Adds a paid Toot, as `insertToot`, while its payment is paid and unused, and uses the payment up
 * (`saved_at`) in the same transaction, so a Toot paid for once is saved once (ADR 0010): deleted,
 * it can't come back, even after its tombstone is purged. True if added.
 */
export async function insertPaidToot(
  db: Database,
  userId: string,
  t: NewToot,
  limit: number
): Promise<boolean> {
  const useUp = db.run(sql`
    update toot_payments set saved_at = ${d1Now}
    where user_id = ${userId} and toot_id = ${t.id} and paid_at is not null
      and saved_at is null
      and exists (select 1 from toots where user_id = ${userId} and id = ${t.id})`)
  // D1's batch is one transaction. Drizzle's own `batch` can't run a raw query with parameters.
  const statement = (query: { getQuery(): { sql: string; params: unknown[] } }) => {
    const built = query.getQuery()
    return db.$client.prepare(built.sql).bind(...built.params)
  }
  const [added] = await db.$client.batch([
    statement(tootInsert(db, userId, t, limit, true)),
    statement(useUp)
  ])
  return added.results.length === 1
}

/**
 * Turns a live row into a tombstone. A Toot's title, the one thing a user types, is cleared.
 * Returns the row's status before: `live` if this call deleted it.
 */
export async function tombstone(
  db: Database,
  kind: Kind,
  userId: string,
  id: string
): Promise<ItemStatus> {
  const live = and(whereItem(kind, userId, id), isNull(tables[kind].deletedAt))
  const deleted =
    kind === 'toots'
      ? await db
          .update(toots)
          .set({ title: '', deletedAt: d1Now, updatedAt: d1Now })
          .where(live)
          .returning({ id: toots.id })
      : await db
          .update(recordings)
          .set({ deletedAt: d1Now, updatedAt: d1Now })
          .where(live)
          .returning({ id: recordings.id })
  return deleted.length === 1 ? 'live' : itemStatus(db, kind, userId, id)
}

/**
 * How long a tombstone stays: 30 days. A browser needs one only until its next library read, and a
 * signed-in browser reads on every open; a session ends after 7 days without one. A browser whose
 * last read is older than this gets the whole library instead (`full` in `GET /api/library/`), so
 * any retention is correct and this one only bounds the rows: the deletes of 30 days.
 */
export const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

/** Deletes the user's tombstones older than `TOMBSTONE_RETENTION_MS`, by D1's own clock. */
export async function purgeTombstones(db: Database, userId: string): Promise<void> {
  const horizon = sql`${d1Now} - ${TOMBSTONE_RETENTION_MS}`
  const old = (kind: Kind) =>
    and(
      eq(tables[kind].userId, userId),
      isNotNull(tables[kind].deletedAt),
      lt(tables[kind].updatedAt, horizon)
    )
  await db.batch([
    db.delete(recordings).where(old('recordings')),
    db.delete(toots).where(old('toots'))
  ])
}

/** Renames a live Toot; the last rename to arrive wins. Returns the row's status before. */
export async function renameToot(
  db: Database,
  userId: string,
  id: string,
  title: string
): Promise<ItemStatus> {
  const renamed = await db
    .update(toots)
    .set({ title, updatedAt: d1Now })
    .where(and(whereItem('toots', userId, id), isNull(toots.deletedAt)))
    .returning({ id: toots.id })
  return renamed.length === 1 ? 'live' : itemStatus(db, 'toots', userId, id)
}

/**
 * What a PATCH changes on a Recording: its Placed Pitch (ADR 0015), its Trim (ADR 0019) or both,
 * each null to take it off. A field left out stays as it is.
 */
export type Placement = { placedPitch?: number | null; trim?: Trim | null }

/**
 * Places a live Recording on a note and trims it, or takes either off with null; the last to
 * arrive wins. Returns the row's status before.
 */
export async function placeRecording(
  db: Database,
  userId: string,
  id: string,
  change: Placement
): Promise<ItemStatus> {
  const trim =
    change.trim === undefined
      ? {}
      : {
          trimStartSeconds: change.trim?.startSeconds ?? null,
          trimEndSeconds: change.trim?.endSeconds ?? null
        }
  const placedPitch = change.placedPitch === undefined ? {} : { placedPitch: change.placedPitch }
  const placed = await db
    .update(recordings)
    .set({ ...placedPitch, ...trim, updatedAt: d1Now })
    .where(and(whereItem('recordings', userId, id), isNull(recordings.deletedAt)))
    .returning({ id: recordings.id })
  return placed.length === 1 ? 'live' : itemStatus(db, 'recordings', userId, id)
}

export type RecordingRow = typeof recordings.$inferSelect
export type TootRow = typeof toots.$inferSelect

/**
 * The user's rows changed at or after `since` (epoch milliseconds), tombstones included, and the
 * `cursor` to pass as the next `since`. A row can come back twice, never be missed.
 */
export async function libraryChanges(
  db: Database,
  userId: string,
  since: number
): Promise<{ cursor: number; recordings: RecordingRow[]; toots: TootRow[] }> {
  const after = new Date(since)
  const [clock, recordingRows, tootRows] = await db.batch([
    db.select({ now: d1Now }).from(user).where(eq(user.id, userId)),
    db
      .select()
      .from(recordings)
      .where(and(eq(recordings.userId, userId), gte(recordings.updatedAt, after))),
    db
      .select()
      .from(toots)
      .where(and(eq(toots.userId, userId), gte(toots.updatedAt, after)))
  ])
  if (clock.length === 0) throw new Error('The signed-in user has no row')
  return { cursor: Number(clock[0].now), recordings: recordingRows, toots: tootRows }
}

/** Turns Farty news by email on or off. False if the user has no row. */
export async function setMarketingEmail(
  db: Database,
  userId: string,
  marketingEmail: boolean
): Promise<boolean> {
  const updated = await db
    .update(user)
    .set({ marketingEmail, updatedAt: new Date() })
    .where(eq(user.id, userId))
    .returning({ id: user.id })
  return updated.length === 1
}

/**
 * Deletes the user's row and any sign-in code still waiting for their email, in one batch. The
 * foreign keys' `on delete cascade` deletes their sessions, sign-in methods, Recordings and Toots
 * with the row. A code's row names the email (`sign-in-otp-<lowercased email>`), not the user.
 */
export async function deleteUser(db: Database, userId: string): Promise<void> {
  const email = sql`(select ${user.email} from ${user} where ${user.id} = ${userId})`
  await db.batch([
    db
      .delete(verification)
      .where(eq(verification.identifier, sql`'sign-in-otp-' || lower(${email})`)),
    db.delete(user).where(eq(user.id, userId))
  ])
}
