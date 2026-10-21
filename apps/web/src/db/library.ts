import { and, count, eq, gte, isNotNull, isNull, lt, sql } from 'drizzle-orm'

import type { Analysis } from '../lib/recordings'
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
  audioBytes: number
}

/** A Toot to keep, as the browser uploads it. */
export type NewToot = {
  id: string
  title: string
  songId: string
  createdAt: number
  seconds: number
  arrangement: TootArrangement
  audioBytes: number
}

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
      analysis, audio_bytes, updated_at)
    select ${userId}, ${r.id}, ${r.number}, ${r.createdAt}, ${r.seconds}, ${r.sampleRate},
      ${JSON.stringify(r.waveform)}, ${analysis}, ${r.audioBytes}, ${d1Now}
    where (select count(*) from recordings where user_id = ${userId} and deleted_at is null)
      < ${limit}
    on conflict do nothing
    returning id`)
  return added.length === 1
}

/** Adds the Toot, as `insertRecording` adds a Recording. True if added. */
export async function insertToot(
  db: Database,
  userId: string,
  t: NewToot,
  limit: number
): Promise<boolean> {
  const added = await db.all(sql`
    insert into toots (user_id, id, title, song_id, created_at, seconds, arrangement,
      audio_bytes, updated_at)
    select ${userId}, ${t.id}, ${t.title}, ${t.songId}, ${t.createdAt}, ${t.seconds},
      ${JSON.stringify(t.arrangement)}, ${t.audioBytes}, ${d1Now}
    where (select count(*) from toots where user_id = ${userId} and deleted_at is null)
      < ${limit}
    on conflict do nothing
    returning id`)
  return added.length === 1
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

/** Turns Pedos news by email on or off. False if the user has no row. */
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
