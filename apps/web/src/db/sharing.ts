import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'

import type { Database } from './database'
import type { Kind, RecordingRow, TootRow } from './library'
import { handles, recordings, shareReports, shares, toots, user } from './schema'

export type ShareRow = typeof shares.$inferSelect

export async function handleOf(db: Database, userId: string): Promise<string | null> {
  const rows = await db
    .select({ handle: handles.handle })
    .from(handles)
    .where(eq(handles.userId, userId))
  return rows[0]?.handle ?? null
}

export async function emailOf(db: Database, userId: string): Promise<string | null> {
  const rows = await db.select({ email: user.email }).from(user).where(eq(user.id, userId))
  return rows[0]?.email ?? null
}

export async function handleTaken(db: Database, handle: string): Promise<boolean> {
  const rows = await db
    .select({ userId: handles.userId })
    .from(handles)
    .where(eq(handles.handle, handle))
  return rows.length > 0
}

export async function claimHandle(
  db: Database,
  userId: string,
  handle: string,
  now: Date
): Promise<'claimed' | 'hasOne' | 'taken'> {
  const added = await db
    .insert(handles)
    .values({ userId, handle, createdAt: now })
    .onConflictDoNothing()
    .returning({ userId: handles.userId })
  if (added.length === 1) return 'claimed'
  return (await handleOf(db, userId)) === null ? 'taken' : 'hasOne'
}

const whereItem = (userId: string, kind: Kind, itemId: string) =>
  and(eq(shares.userId, userId), eq(shares.kind, kind), eq(shares.itemId, itemId))

export async function shareOf(
  db: Database,
  userId: string,
  kind: Kind,
  itemId: string
): Promise<ShareRow | null> {
  const rows = await db
    .select()
    .from(shares)
    .where(whereItem(userId, kind, itemId))
  return rows[0] ?? null
}

export async function addShare(
  db: Database,
  share: { id: string; userId: string; kind: Kind; itemId: string; createdAt: Date }
): Promise<{ share: ShareRow; created: boolean }> {
  const added = await db.insert(shares).values(share).onConflictDoNothing().returning()
  if (added.length === 1) return { share: added[0], created: true }
  const existing = await shareOf(db, share.userId, share.kind, share.itemId)
  if (!existing) throw new Error('The share is neither new nor there')
  return { share: existing, created: false }
}

export async function removeShare(
  db: Database,
  userId: string,
  kind: Kind,
  itemId: string
): Promise<boolean> {
  const removed = await db
    .delete(shares)
    .where(and(whereItem(userId, kind, itemId), isNull(shares.takenDownAt)))
    .returning({ id: shares.id })
  return removed.length > 0
}

const IN_BATCH = 90

function tootRecordingIds(toot: Pick<TootRow, 'arrangement' | 'performance'>): string[] {
  return [
    ...new Set([
      ...Object.values(toot.arrangement?.recordingForPitch ?? {}),
      ...(toot.performance?.recordings ?? [])
    ])
  ]
}

export async function takenDownRecordings(db: Database, userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ itemId: shares.itemId })
    .from(shares)
    .where(
      and(eq(shares.userId, userId), eq(shares.kind, 'recordings'), isNotNull(shares.takenDownAt))
    )
  return new Set(rows.map(row => row.itemId))
}

const playsAny = (toot: Pick<TootRow, 'arrangement' | 'performance'>, ids: Set<string>) =>
  ids.size > 0 && tootRecordingIds(toot).some(id => ids.has(id))

export async function tootPlaysTakenDown(
  db: Database,
  userId: string,
  tootId: string
): Promise<boolean> {
  const takenDown = await takenDownRecordings(db, userId)
  if (takenDown.size === 0) return false
  const rows = await db
    .select({ arrangement: toots.arrangement, performance: toots.performance })
    .from(toots)
    .where(and(eq(toots.userId, userId), eq(toots.id, tootId)))
  return rows.some(toot => playsAny(toot, takenDown))
}

export async function tootsPlayingTakenDown(
  db: Database,
  userId: string,
  tootIds: string[],
  takenDown: Set<string>
): Promise<Set<string>> {
  const down = new Set<string>()
  if (takenDown.size === 0) return down
  for (let at = 0; at < tootIds.length; at += IN_BATCH) {
    const rows = await db
      .select({ id: toots.id, arrangement: toots.arrangement, performance: toots.performance })
      .from(toots)
      .where(and(eq(toots.userId, userId), inArray(toots.id, tootIds.slice(at, at + IN_BATCH))))
    for (const toot of rows) if (playsAny(toot, takenDown)) down.add(toot.id)
  }
  return down
}

export async function liveShares(
  db: Database,
  userId: string
): Promise<{ kind: Kind; itemId: string; id: string }[]> {
  const live = await db
    .select({ kind: shares.kind, itemId: shares.itemId, id: shares.id })
    .from(shares)
    .where(and(eq(shares.userId, userId), isNull(shares.takenDownAt)))
  const tootIds = live.filter(share => share.kind === 'toots').map(share => share.itemId)
  if (tootIds.length === 0) return live
  const takenDown = await takenDownRecordings(db, userId)
  if (takenDown.size === 0) return live
  const down = await tootsPlayingTakenDown(db, userId, tootIds, takenDown)
  return live.filter(share => share.kind !== 'toots' || !down.has(share.itemId))
}

export type SharedRecordingRow = { share: ShareRow; handle: string; recording: RecordingRow }

export async function sharedRecording(
  db: Database,
  handle: string,
  shareId: string
): Promise<SharedRecordingRow | null> {
  const rows = await db
    .select({ share: shares, handle: handles.handle, recording: recordings })
    .from(shares)
    .innerJoin(handles, eq(handles.userId, shares.userId))
    .innerJoin(
      recordings,
      and(eq(recordings.userId, shares.userId), eq(recordings.id, shares.itemId))
    )
    .where(
      and(
        eq(shares.id, shareId),
        eq(shares.kind, 'recordings'),
        isNull(shares.takenDownAt),
        eq(handles.handle, handle),
        isNull(recordings.deletedAt)
      )
    )
  return rows[0] ?? null
}

export type SharedTootRow = { share: ShareRow; handle: string; toot: TootRow }

export async function sharedToot(
  db: Database,
  handle: string,
  shareId: string
): Promise<SharedTootRow | null> {
  const rows = await db
    .select({ share: shares, handle: handles.handle, toot: toots })
    .from(shares)
    .innerJoin(handles, eq(handles.userId, shares.userId))
    .innerJoin(toots, and(eq(toots.userId, shares.userId), eq(toots.id, shares.itemId)))
    .where(
      and(
        eq(shares.id, shareId),
        eq(shares.kind, 'toots'),
        isNull(shares.takenDownAt),
        eq(handles.handle, handle),
        isNull(toots.deletedAt)
      )
    )
  const row = rows[0]
  if (!row) return null
  return playsAny(row.toot, await takenDownRecordings(db, row.share.userId)) ? null : row
}

export async function addReport(db: Database, share: ShareRow, id: string, now: Date) {
  await db.insert(shareReports).values({
    id,
    shareId: share.id,
    userId: share.userId,
    kind: share.kind,
    itemId: share.itemId,
    createdAt: now
  })
}
