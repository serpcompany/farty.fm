import type { Database } from '@/db/database'
import {
  acceptFriendRequest,
  addFriendRequest,
  deleteFriendRequest,
  type FriendState,
  friendLists,
  friendState,
  removeFriend,
  userWithHandle
} from '@/db/friends'
import { handleOf } from '@/db/sharing'
import { normalizeHandle } from '@/lib/handle'

import { consumeSlots, keyedHash, type SlotRule } from './auth-config'
import { wrongLibrary } from './library'
import { readJson } from './library-input'
import { apiError, type SessionUser } from './require-user'

// Friends (#319, ADR 0021), under `src/app/api/friends/` with `userRoute`. A user asks another by
// their Handle, from that user's page or Profile's Add friend, and the other accepts or declines.
// Every route acts only between the signed-in user and the Handle in it, so no one accepts,
// declines, cancels or removes a request or friendship that isn't theirs.

/**
 * How many friend requests a user sends, each a row in `rate_limit` (`consumeSlots`): a few an
 * hour, so no one can ask every Handle, and a few a day to the same person, so asking again after
 * a decline can't become a stream of requests. A request spends a slot of each only when both have
 * one.
 */
export const FRIEND_REQUEST_LIMITS = {
  perSender: { window: 60 * 60, max: 20 },
  perPair: { window: 24 * 60 * 60, max: 3 }
} satisfies Record<string, SlotRule>

/** A sender's row for friend requests an hour: an HMAC of their user id, as every key is. */
export async function friendRequesterKey(secret: string, userId: string): Promise<string> {
  return `friend-requester|${await keyedHash(secret, 'friend-requester-limit', userId)}`
}

/** A sender's row for requests to one user a day. */
export async function friendPairKey(secret: string, fromId: string, toId: string) {
  return `friend-pair|${await keyedHash(secret, 'friend-pair-limit', `${fromId}\0${toId}`)}`
}

/** A Handle as it's typed or in a link: lowercased, and only one that could be someone's. */
function handleIn(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const handle = normalizeHandle(value)
  // The shape only, as a shared link's: a Handle the block list gained since still finds them.
  return /^[a-z0-9_]{3,20}$/.test(handle) ? handle : null
}

/** How a request came out, for the API and for a request sent another way, such as at sign-up. */
export type FriendRequestRefusal =
  | 'no_such_handle'
  | 'own_handle'
  | 'no_handle'
  | 'already_requested'
  | 'already_friends'
  | 'too_many_requests'

export type FriendRequestResult =
  | { sent: 'requested' | 'friends' }
  | { refused: FriendRequestRefusal }

/**
 * `fromId` asks the user whose Handle is `handle` to be friends: `requested`, or `friends` when
 * that user had already asked them, which accepts theirs. Refused when no one has `handle`, when
 * it's their own, when `fromId` has no Handle yet (whoever they ask sees them by it), when they
 * already asked or are friends, and past `FRIEND_REQUEST_LIMITS`. Reusable outside the API: Get
 * Farty's sign-up (#318) can send one this way, once the new user has a Handle.
 */
export async function requestFriend(
  db: Database,
  fromId: string,
  handle: string,
  secret: string,
  now: Date = new Date()
): Promise<FriendRequestResult> {
  const typed = handleIn(handle)
  const toId = typed === null ? null : await userWithHandle(db, typed)
  if (toId === null) return { refused: 'no_such_handle' }
  if (toId === fromId) return { refused: 'own_handle' }
  if ((await handleOf(db, fromId)) === null) return { refused: 'no_handle' }
  const state = await friendState(db, fromId, toId)
  if (state === 'friends') return { refused: 'already_friends' }
  if (state === 'requested') return { refused: 'already_requested' }
  // They asked first: asking back is saying yes. Unless they've just cancelled, so ask.
  if (state === 'asked' && (await acceptFriendRequest(db, fromId, toId, now))) {
    return { sent: 'friends' }
  }
  const allowed = await consumeSlots(
    db.$client,
    [
      { key: await friendRequesterKey(secret, fromId), rule: FRIEND_REQUEST_LIMITS.perSender },
      { key: await friendPairKey(secret, fromId, toId), rule: FRIEND_REQUEST_LIMITS.perPair }
    ],
    now.getTime()
  )
  if (!allowed) return { refused: 'too_many_requests' }
  if (await addFriendRequest(db, fromId, toId, now)) return { sent: 'requested' }
  // Something changed since the read: they became friends, or one asked at the same moment.
  const after = await friendState(db, fromId, toId)
  if (after === 'friends') return { refused: 'already_friends' }
  if (after === 'asked') {
    return (await acceptFriendRequest(db, fromId, toId, now))
      ? { sent: 'friends' }
      : { refused: 'already_requested' }
  }
  return { refused: 'already_requested' }
}

const REFUSED_STATUS = {
  no_handle: 409,
  no_such_handle: 404,
  own_handle: 400,
  already_requested: 409,
  already_friends: 409,
  too_many_requests: 429
} as const

/** `GET /api/friends/`: the user's Handle, who asked them, their friends and whom they asked. */
export async function listFriends(db: Database, user: SessionUser) {
  const [handle, lists] = await Promise.all([handleOf(db, user.id), friendLists(db, user.id)])
  return Response.json({ handle, ...lists })
}

/**
 * `POST /api/friends/` with `{ handle }`: asks them (`requestFriend`). 201 `requested`, or 200
 * `friends` when they'd asked first. 404 `no_such_handle`, 400 `own_handle`, 409 `no_handle`,
 * `already_requested` or `already_friends`, 429 `too_many_requests`.
 */
export async function sendFriendRequest(
  db: Database,
  user: SessionUser,
  request: Request,
  secret: string
): Promise<Response> {
  const wrong = wrongLibrary(user, request)
  if (wrong) return wrong
  const body = await readJson(request)
  if (body instanceof Response) return body
  const typed = (body.json as { handle?: unknown } | null)?.handle
  if (typeof typed !== 'string') return apiError(400, 'invalid_request')
  const result = await requestFriend(db, user.id, typed, secret)
  if ('refused' in result) return apiError(REFUSED_STATUS[result.refused], result.refused)
  return Response.json({ state: result.sent }, { status: result.sent === 'requested' ? 201 : 200 })
}

/** Where the user stands with the user at a Handle in a path, or a response that ends it. */
async function otherUser(
  db: Database,
  user: SessionUser,
  handle: string
): Promise<{ otherId: string } | { own: true } | Response> {
  const typed = handleIn(handle)
  const otherId = typed === null ? null : await userWithHandle(db, typed)
  if (otherId === null) return apiError(404, 'no_such_handle')
  return otherId === user.id ? { own: true } : { otherId }
}

/** `GET /api/friends/{handle}/`: `{ state }`, how the user stands with them, or `own`. */
export async function friendStatus(db: Database, user: SessionUser, handle: string) {
  const other = await otherUser(db, user, handle)
  if (other instanceof Response) return other
  const state: FriendState | 'own' =
    'own' in other ? 'own' : await friendState(db, user.id, other.otherId)
  return Response.json({ state })
}

export type FriendAction = 'accept' | 'decline' | 'cancel' | 'remove'
const ACTIONS: readonly FriendAction[] = ['accept', 'decline', 'cancel', 'remove']

/**
 * `POST /api/friends/{handle}/` with `{ action }`, between the user and them only: `accept` or
 * `decline` their request to the user, `cancel` the user's to them, or `remove` the friendship.
 * Declining and removing tell no one. 200 with the `state` after, 404 `not_found` when there's
 * nothing of the user's to act on, so a request or friendship between others is never reached.
 */
export async function actOnFriend(
  db: Database,
  user: SessionUser,
  handle: string,
  request: Request
): Promise<Response> {
  const wrong = wrongLibrary(user, request)
  if (wrong) return wrong
  const body = await readJson(request)
  if (body instanceof Response) return body
  const action = (body.json as { action?: unknown } | null)?.action
  if (!ACTIONS.includes(action as FriendAction)) return apiError(400, 'invalid_request')
  const other = await otherUser(db, user, handle)
  if (other instanceof Response) return other
  if ('own' in other) return apiError(400, 'own_handle')
  const { otherId } = other
  const done =
    action === 'accept'
      ? await acceptFriendRequest(db, user.id, otherId, new Date())
      : action === 'decline'
        ? await deleteFriendRequest(db, otherId, user.id)
        : action === 'cancel'
          ? await deleteFriendRequest(db, user.id, otherId)
          : await removeFriend(db, user.id, otherId)
  if (!done) return apiError(404, 'not_found')
  return Response.json({ state: await friendState(db, user.id, otherId) })
}
