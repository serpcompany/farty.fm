import { and, eq, isNull } from 'drizzle-orm'

import type { Database } from './database'
import type { Kind, RecordingRow, TootRow } from './library'
import { handles, recordings, shareReports, shares, toots, user } from './schema'

// Sharing in D1 (ADR 0020): Handles, shares and reports. The owner's queries take the session's
// user id and filter on it, so one user never shares or stops sharing another's item. The public
// lookups find an item only through a share that isn't taken down, its owner's Handle, and the
// live item itself.

export type ShareRow = typeof shares.$inferSelect

/** The user's Handle, or null before their first share. */
export async function handleOf(db: Database, userId: string): Promise<string | null> {
  const rows = await db
    .select({ handle: handles.handle })
    .from(handles)
    .where(eq(handles.userId, userId))
  return rows[0]?.handle ?? null
}

/** The user's email, which their first Handle is suggested from. */
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

/**
 * Gives the user `handle`, once: `claimed`, or `hasOne` when they already have a Handle, or
 * `taken` when someone else has this one. One statement, so two claims at once can't both win.
 */
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

/** The user's share of one item, taken down or not. */
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

/**
 * Shares the item with a new link `id`, or keeps the link it already has. Returns the share,
 * and whether this call made it.
 */
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

/**
 * Stops sharing the item: deletes its share, so its link stops working and sharing it again makes
 * a new one. A share Farty took down stays, so the item stays down. True if a share was deleted.
 */
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

/** The user's shares that work: each item's kind, id and link id. */
export async function liveShares(
  db: Database,
  userId: string
): Promise<{ kind: Kind; itemId: string; id: string }[]> {
  return db
    .select({ kind: shares.kind, itemId: shares.itemId, id: shares.id })
    .from(shares)
    .where(and(eq(shares.userId, userId), isNull(shares.takenDownAt)))
}

/** A shared Recording, as anyone with its link finds it. */
export type SharedRecordingRow = { share: ShareRow; handle: string; recording: RecordingRow }

/**
 * The Recording shared at `/u/<handle>/r/<shareId>/`: only while it's shared under that Handle,
 * not taken down, and not deleted. Anything else is not found, the same way.
 */
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

/** A shared Toot, as anyone with its link finds it. */
export type SharedTootRow = { share: ShareRow; handle: string; toot: TootRow }

/**
 * The saved Toot shared at `/u/<handle>/t/<shareId>/`, as `sharedRecording` finds a Recording: only
 * while it's shared under that Handle, not taken down, and not deleted. A Toot is in `toots` only
 * once it's saved, so an unsaved one is never found.
 */
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
  return rows[0] ?? null
}

/** Keeps a report of `share` for Farty to check. */
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
