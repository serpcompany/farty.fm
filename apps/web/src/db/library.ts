import { and, count, eq, gte, isNotNull, isNull, lt, sql } from 'drizzle-orm'

import type { Performance } from '../lib/performance'
import type { Analysis, RecordingTrim } from '../lib/recordings'
import type { TootArrangement } from '../lib/toot'
import { d1Now } from './d1-clock'
import type { Database } from './database'
import { favoriteSongs, recordings, toots, user, verification } from './schema'

export type Kind = 'recordings' | 'toots'

const tables = { recordings, toots }

export type NewRecording = {
  id: string
  number: number
  createdAt: number
  seconds: number
  sampleRate: number
  waveform: number[]
  analysis: Analysis | null
  placedPitch: number | null
  trim: RecordingTrim | null
  name: string | null
  audioBytes: number
}

type NewToot = TootFields & { audioBytes: number }

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

export async function insertRecording(
  db: Database,
  userId: string,
  r: NewRecording,
  limit: number
): Promise<boolean> {
  const analysis = r.analysis === null ? null : JSON.stringify(r.analysis)
  const added = await db.all(sql`
    insert into recordings (user_id, id, number, created_at, seconds, sample_rate, waveform,
      analysis, placed_pitch, trim_start_seconds, trim_end_seconds, trim_fart_start_seconds,
      trim_fart_end_seconds, name, audio_bytes, updated_at)
    select ${userId}, ${r.id}, ${r.number}, ${r.createdAt}, ${r.seconds}, ${r.sampleRate},
      ${JSON.stringify(r.waveform)}, ${analysis}, ${r.placedPitch},
      ${r.trim?.startSeconds ?? null}, ${r.trim?.endSeconds ?? null},
      ${r.trim?.fart.startSeconds ?? null}, ${r.trim?.fart.endSeconds ?? null}, ${r.name},
      ${r.audioBytes}, ${d1Now}
    where (select count(*) from recordings where user_id = ${userId} and deleted_at is null)
      < ${limit}
    on conflict do nothing
    returning id`)
  return added.length === 1
}

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

export async function insertToot(
  db: Database,
  userId: string,
  t: NewToot,
  limit: number
): Promise<boolean> {
  return (await tootInsert(db, userId, t, limit, false)).length === 1
}

type RawQuery = { getQuery(): { sql: string; params: unknown[] } }

function asD1Statement(db: Database, query: RawQuery): D1PreparedStatement {
  const built = query.getQuery()
  return db.$client.prepare(built.sql).bind(...built.params)
}

export async function insertPaidToot(
  db: Database,
  userId: string,
  t: NewToot,
  limit: number
): Promise<boolean> {
  const useUpPayment = db.run(sql`
    update toot_payments set saved_at = ${d1Now}
    where user_id = ${userId} and toot_id = ${t.id} and paid_at is not null
      and saved_at is null
      and exists (select 1 from toots where user_id = ${userId} and id = ${t.id})`)
  const [added] = await db.$client.batch([
    asD1Statement(db, tootInsert(db, userId, t, limit, true)),
    asD1Statement(db, useUpPayment)
  ])
  return added.results.length === 1
}

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

export async function forgetDeleted(
  db: Database,
  kind: Kind,
  userId: string,
  id: string
): Promise<void> {
  await db
    .delete(tables[kind])
    .where(and(whereItem(kind, userId, id), isNotNull(tables[kind].deletedAt)))
}

export const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

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
    db.delete(toots).where(old('toots')),
    db
      .delete(favoriteSongs)
      .where(
        and(
          eq(favoriteSongs.userId, userId),
          isNotNull(favoriteSongs.deletedAt),
          lt(favoriteSongs.updatedAt, horizon)
        )
      )
  ])
}

export async function favoriteSong(
  db: Database,
  userId: string,
  songId: string,
  limit: number
): Promise<'added' | 'kept' | 'limit'> {
  const [added, live] = await db.batch([
    db
      .insert(favoriteSongs)
      .select(
        sql`select ${userId}, ${songId}, ${d1Now}, ${d1Now}, null
          where (select count(*) from ${favoriteSongs}
            where ${favoriteSongs.userId} = ${userId} and ${favoriteSongs.deletedAt} is null)
            < ${limit}`
      )
      .onConflictDoUpdate({
        target: [favoriteSongs.userId, favoriteSongs.songId],
        set: { deletedAt: null, updatedAt: d1Now },
        setWhere: isNotNull(favoriteSongs.deletedAt)
      })
      .returning({ songId: favoriteSongs.songId }),
    db
      .select({ songId: favoriteSongs.songId })
      .from(favoriteSongs)
      .where(
        and(
          eq(favoriteSongs.userId, userId),
          eq(favoriteSongs.songId, songId),
          isNull(favoriteSongs.deletedAt)
        )
      )
  ])
  if (added.length === 1) return 'added'
  return live.length === 1 ? 'kept' : 'limit'
}

export async function unfavoriteSong(db: Database, userId: string, songId: string): Promise<void> {
  await db
    .update(favoriteSongs)
    .set({ deletedAt: d1Now, updatedAt: d1Now })
    .where(
      and(
        eq(favoriteSongs.userId, userId),
        eq(favoriteSongs.songId, songId),
        isNull(favoriteSongs.deletedAt)
      )
    )
}

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

type Placement = {
  placedPitch?: number | null
  trim?: RecordingTrim | null
  name?: string | null
}

export async function placeRecording(
  db: Database,
  userId: string,
  id: string,
  change: Placement,
  tolerance: number
): Promise<ItemStatus | 'tooLong'> {
  const trim =
    change.trim === undefined
      ? {}
      : {
          trimStartSeconds: change.trim?.startSeconds ?? null,
          trimEndSeconds: change.trim?.endSeconds ?? null,
          trimFartStartSeconds: change.trim?.fart.startSeconds ?? null,
          trimFartEndSeconds: change.trim?.fart.endSeconds ?? null
        }
  const placedPitch = change.placedPitch === undefined ? {} : { placedPitch: change.placedPitch }
  const name = change.name === undefined ? {} : { name: change.name }
  const placed = await db
    .update(recordings)
    .set({ ...placedPitch, ...trim, ...name, updatedAt: d1Now })
    .where(
      and(
        whereItem('recordings', userId, id),
        isNull(recordings.deletedAt),
        change.trim ? gte(recordings.seconds, change.trim.endSeconds - tolerance) : undefined
      )
    )
    .returning({ id: recordings.id })
  if (placed.length === 1) return 'live'
  const status = await itemStatus(db, 'recordings', userId, id)
  return status === 'live' ? 'tooLong' : status
}

export type RecordingRow = typeof recordings.$inferSelect
export type TootRow = typeof toots.$inferSelect
type FavoriteSongRow = { songId: string; deletedAt: Date | null }

export async function libraryChanges(
  db: Database,
  userId: string,
  since: number
): Promise<{
  cursor: number
  recordings: RecordingRow[]
  toots: TootRow[]
  favoriteSongs: FavoriteSongRow[]
}> {
  const after = new Date(since)
  const [clock, recordingRows, tootRows, favoriteRows] = await db.batch([
    db.select({ now: d1Now }).from(user).where(eq(user.id, userId)),
    db
      .select()
      .from(recordings)
      .where(and(eq(recordings.userId, userId), gte(recordings.updatedAt, after))),
    db
      .select()
      .from(toots)
      .where(and(eq(toots.userId, userId), gte(toots.updatedAt, after))),
    db
      .select({ songId: favoriteSongs.songId, deletedAt: favoriteSongs.deletedAt })
      .from(favoriteSongs)
      .where(and(eq(favoriteSongs.userId, userId), gte(favoriteSongs.updatedAt, after)))
  ])
  if (clock.length === 0) throw new Error('The signed-in user has no row')
  return {
    cursor: Number(clock[0].now),
    recordings: recordingRows,
    toots: tootRows,
    favoriteSongs: favoriteRows
  }
}

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

export async function deleteUser(db: Database, userId: string): Promise<void> {
  const email = sql`(select ${user.email} from ${user} where ${user.id} = ${userId})`
  await db.batch([
    db
      .delete(verification)
      .where(eq(verification.identifier, sql`'sign-in-otp-' || lower(${email})`)),
    db.delete(user).where(eq(user.id, userId))
  ])
}
