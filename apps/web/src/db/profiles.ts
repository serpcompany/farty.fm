import { and, eq, isNull } from 'drizzle-orm'

import type { Database } from './database'
import type { RecordingRow, TootRow } from './library'
import { handles, profileReports, recordings, shares, toots } from './schema'
import { withoutTakenDownRecordings } from './sharing'

// Profile pages in D1 (#319, ADR 0021): `/u/<handle>/` lists what its user shares, and nothing
// else. A share that was stopped, taken down, or whose Recording, Toot or account was deleted
// isn't listed, the same as its own link doesn't work, and neither is a Toot that plays a
// Recording Farty took down (#346).

/** The user whose Handle is `handle`, as their page shows it, or null when no one has it. */
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

/** A shared Recording or saved Toot on its owner's page. */
export type ProfileShareRow = { shareId: string; sharedAt: Date } & (
  | { kind: 'recordings'; recording: RecordingRow }
  | { kind: 'toots'; toot: Pick<TootRow, 'title' | 'songId'> }
)

/** Newest share first, and by link id when two were shared at once, as D1 would order them. */
const newestFirst = (a: ProfileShareRow, b: ProfileShareRow) =>
  b.sharedAt.getTime() - a.sharedAt.getTime() ||
  (a.shareId < b.shareId ? 1 : a.shareId > b.shareId ? -1 : 0)

/** The Recordings and Toots `userId` shares that work, newest share first. */
export async function profileShares(db: Database, userId: string): Promise<ProfileShareRow[]> {
  const live = (kind: 'recordings' | 'toots') =>
    and(eq(shares.userId, userId), eq(shares.kind, kind), isNull(shares.takenDownAt))
  const [recordingRows, tootRows] = await Promise.all([
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
        title: toots.title,
        songId: toots.songId,
        arrangement: toots.arrangement,
        performance: toots.performance
      })
      .from(shares)
      .innerJoin(toots, and(eq(toots.userId, shares.userId), eq(toots.id, shares.itemId)))
      .where(and(live('toots'), isNull(toots.deletedAt)))
  ])
  const liveToots = await withoutTakenDownRecordings(db, userId, tootRows)
  return [
    ...recordingRows.map(row => ({ kind: 'recordings' as const, ...row })),
    ...liveToots.map(({ shareId, sharedAt, title, songId }) => ({
      kind: 'toots' as const,
      shareId,
      sharedAt,
      toot: { title, songId }
    }))
  ].sort(newestFirst)
}

/** Keeps a report of `userId`'s page for Farty to check. */
export async function addProfileReport(db: Database, userId: string, id: string, now: Date) {
  await db.insert(profileReports).values({ id, userId, createdAt: now })
}
