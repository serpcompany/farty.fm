import { and, eq, isNull } from 'drizzle-orm'

import type { Database } from './database'
import type { RecordingRow, TootRow } from './library'
import { handles, profileReports, recordings, shares, toots } from './schema'
import { takenDownRecordings, tootsPlayingTakenDown } from './sharing'

export async function profileUser(
  db: Database,
  handle: string
): Promise<{ userId: string; handle: string } | null> {
  const rows = await db
    .select({ userId: handles.userId, handle: handles.handle })
    .from(handles)
    .where(eq(handles.handle, handle))
  return rows[0] ?? null
}

export type ProfileShareRow = { shareId: string; sharedAt: Date } & (
  | { kind: 'recordings'; recording: RecordingRow }
  | { kind: 'toots'; toot: Pick<TootRow, 'title' | 'songId'> }
)

const newestFirst = (a: ProfileShareRow, b: ProfileShareRow) =>
  b.sharedAt.getTime() - a.sharedAt.getTime() ||
  (a.shareId < b.shareId ? 1 : a.shareId > b.shareId ? -1 : 0)

export async function profileShares(db: Database, userId: string): Promise<ProfileShareRow[]> {
  const live = (kind: 'recordings' | 'toots') =>
    and(eq(shares.userId, userId), eq(shares.kind, kind), isNull(shares.takenDownAt))
  const [recordingRows, tootRows, takenDown] = await Promise.all([
    db
      .select({ shareId: shares.id, sharedAt: shares.createdAt, recording: recordings })
      .from(shares)
      .innerJoin(
        recordings,
        and(eq(recordings.userId, shares.userId), eq(recordings.id, shares.itemId))
      )
      .where(and(live('recordings'), isNull(recordings.deletedAt))),
    db
      .select({
        shareId: shares.id,
        sharedAt: shares.createdAt,
        tootId: toots.id,
        title: toots.title,
        songId: toots.songId
      })
      .from(shares)
      .innerJoin(toots, and(eq(toots.userId, shares.userId), eq(toots.id, shares.itemId)))
      .where(and(live('toots'), isNull(toots.deletedAt))),
    takenDownRecordings(db, userId)
  ])
  const down = await tootsPlayingTakenDown(
    db,
    userId,
    tootRows.map(row => row.tootId),
    takenDown
  )
  return [
    ...recordingRows.map(row => ({ kind: 'recordings' as const, ...row })),
    ...tootRows
      .filter(row => !down.has(row.tootId))
      .map(({ shareId, sharedAt, title, songId }) => ({
        kind: 'toots' as const,
        shareId,
        sharedAt,
        toot: { title, songId }
      }))
  ].sort(newestFirst)
}

export async function addProfileReport(db: Database, userId: string, id: string, now: Date) {
  await db.insert(profileReports).values({ id, userId, createdAt: now })
}
