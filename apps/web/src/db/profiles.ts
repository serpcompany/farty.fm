import { and, desc, eq, isNull } from 'drizzle-orm'

import type { Database } from './database'
import type { RecordingRow } from './library'
import { handles, profileReports, recordings, shares } from './schema'

// Profile pages in D1 (#319, ADR 0021): `/u/<handle>/` lists what its user shares, and nothing
// else. A share that was stopped, taken down, or whose Recording or account was deleted isn't
// listed, the same as its own link doesn't work.

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

/** A shared Recording on its owner's page. */
export type ProfileShareRow = { shareId: string; sharedAt: Date; recording: RecordingRow }

/**
 * The Recordings `userId` shares that work, newest share first. Toots aren't shared yet (#317), so
 * a share of one isn't listed.
 */
export async function profileShares(db: Database, userId: string): Promise<ProfileShareRow[]> {
  return db
    .select({ shareId: shares.id, sharedAt: shares.createdAt, recording: recordings })
    .from(shares)
    .innerJoin(
      recordings,
      and(eq(recordings.userId, shares.userId), eq(recordings.id, shares.itemId))
    )
    .where(
      and(
        eq(shares.userId, userId),
        eq(shares.kind, 'recordings'),
        isNull(shares.takenDownAt),
        isNull(recordings.deletedAt)
      )
    )
    .orderBy(desc(shares.createdAt), desc(shares.id))
}

/** Keeps a report of `userId`'s page for Farty to check. */
export async function addProfileReport(db: Database, userId: string, id: string, now: Date) {
  await db.insert(profileReports).values({ id, userId, createdAt: now })
}
