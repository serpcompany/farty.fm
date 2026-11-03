import { and, desc, eq, or } from 'drizzle-orm'

import type { Database } from './database'
import { friendRequests, friends, handles } from './schema'

// Friends in D1 (#319, ADR 0021). Every query takes the session's user id and the other user's,
// and reads or changes only the rows between those two, so one user never accepts, declines,
// cancels or removes a request or friendship between two others.

/** How the user stands with another: neither asked, they asked them, the other asked, friends. */
export type FriendState = 'none' | 'requested' | 'asked' | 'friends'

/** The user whose Handle is `handle`, or null when no one has it. */
export async function userWithHandle(db: Database, handle: string): Promise<string | null> {
  const rows = await db
    .select({ userId: handles.userId })
    .from(handles)
    .where(eq(handles.handle, handle))
  return rows[0]?.userId ?? null
}

const requestFrom = (fromId: string, toId: string) =>
  and(eq(friendRequests.fromUserId, fromId), eq(friendRequests.toUserId, toId))

/** How `userId` stands with `otherId`. */
export async function friendState(
  db: Database,
  userId: string,
  otherId: string
): Promise<FriendState> {
  const [friendship, asked, sent] = await db.batch([
    db
      .select({ userId: friends.userId })
      .from(friends)
      .where(and(eq(friends.userId, userId), eq(friends.friendId, otherId))),
    db
      .select({ fromUserId: friendRequests.fromUserId })
      .from(friendRequests)
      .where(requestFrom(otherId, userId)),
    db
      .select({ fromUserId: friendRequests.fromUserId })
      .from(friendRequests)
      .where(requestFrom(userId, otherId))
  ])
  if (friendship.length > 0) return 'friends'
  if (asked.length > 0) return 'asked'
  return sent.length > 0 ? 'requested' : 'none'
}

/**
 * `fromId` asks `toId` to be friends, unless they're friends already or `toId` asked first. One
 * statement, so two requests at once, each way, can't both be made. True if this made it.
 */
export async function addFriendRequest(
  db: Database,
  fromId: string,
  toId: string,
  now: Date
): Promise<boolean> {
  const added = await db.$client
    .prepare(
      `INSERT INTO friend_requests (from_user_id, to_user_id, created_at)
       SELECT ?1, ?2, ?3
       WHERE NOT EXISTS (SELECT 1 FROM friends WHERE user_id = ?1 AND friend_id = ?2)
         AND NOT EXISTS (
           SELECT 1 FROM friend_requests WHERE from_user_id = ?2 AND to_user_id = ?1
         )
       ON CONFLICT DO NOTHING
       RETURNING from_user_id`
    )
    .bind(fromId, toId, now.getTime())
    .run()
  return added.results.length === 1
}

/**
 * `userId` accepts `fromId`'s request: they become friends, a row each way, and every request
 * between them goes. One transaction (D1's batch). False when `fromId` hasn't asked `userId`.
 */
export async function acceptFriendRequest(
  db: Database,
  userId: string,
  fromId: string,
  now: Date
): Promise<boolean> {
  const [made, cleared] = await db.$client.batch<{ from_user_id: string }>([
    db.$client
      .prepare(
        `INSERT INTO friends (user_id, friend_id, created_at)
         SELECT pair.a, pair.b, ?3 FROM (SELECT ?1 AS a, ?2 AS b UNION ALL SELECT ?2, ?1) AS pair
         WHERE EXISTS (
           SELECT 1 FROM friend_requests WHERE from_user_id = ?2 AND to_user_id = ?1
         )
         ON CONFLICT DO NOTHING
         RETURNING user_id AS from_user_id`
      )
      .bind(userId, fromId, now.getTime()),
    // Only once they're friends: a request left between friends means nothing.
    db.$client
      .prepare(
        `DELETE FROM friend_requests
         WHERE ((from_user_id = ?2 AND to_user_id = ?1) OR (from_user_id = ?1 AND to_user_id = ?2))
           AND EXISTS (SELECT 1 FROM friends WHERE user_id = ?1 AND friend_id = ?2)
         RETURNING from_user_id`
      )
      .bind(userId, fromId)
  ])
  return made.results.length > 0 || cleared.results.some(row => row.from_user_id === fromId)
}

/** Deletes `fromId`'s request to `toId`: declined by `toId`, or cancelled by `fromId`. */
export async function deleteFriendRequest(
  db: Database,
  fromId: string,
  toId: string
): Promise<boolean> {
  const deleted = await db
    .delete(friendRequests)
    .where(requestFrom(fromId, toId))
    .returning({ fromUserId: friendRequests.fromUserId })
  return deleted.length > 0
}

/** Ends the friendship between `userId` and `otherId`, both rows. True if they were friends. */
export async function removeFriend(
  db: Database,
  userId: string,
  otherId: string
): Promise<boolean> {
  const removed = await db
    .delete(friends)
    .where(
      or(
        and(eq(friends.userId, userId), eq(friends.friendId, otherId)),
        and(eq(friends.userId, otherId), eq(friends.friendId, userId))
      )
    )
    .returning({ userId: friends.userId })
  return removed.length > 0
}

/** A user's friends and requests, by Handle, each newest first. */
export type FriendLists = {
  /** Who asked the user. */
  requests: string[]
  friends: string[]
  /** Whom the user asked. */
  sent: string[]
}

export async function friendLists(db: Database, userId: string): Promise<FriendLists> {
  const [requests, friendRows, sent] = await db.batch([
    db
      .select({ handle: handles.handle })
      .from(friendRequests)
      .innerJoin(handles, eq(handles.userId, friendRequests.fromUserId))
      .where(eq(friendRequests.toUserId, userId))
      .orderBy(desc(friendRequests.createdAt)),
    db
      .select({ handle: handles.handle })
      .from(friends)
      .innerJoin(handles, eq(handles.userId, friends.friendId))
      .where(eq(friends.userId, userId))
      .orderBy(desc(friends.createdAt)),
    db
      .select({ handle: handles.handle })
      .from(friendRequests)
      .innerJoin(handles, eq(handles.userId, friendRequests.toUserId))
      .where(eq(friendRequests.fromUserId, userId))
      .orderBy(desc(friendRequests.createdAt))
  ])
  const handlesOf = (rows: { handle: string }[]) => rows.map(row => row.handle)
  return { requests: handlesOf(requests), friends: handlesOf(friendRows), sent: handlesOf(sent) }
}
