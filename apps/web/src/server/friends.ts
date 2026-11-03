import { z } from 'zod'

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

import type { SessionUser } from './auth-session'
import { keyedHash } from './hmac'
import { apiError, notFound } from './http'
import { wrongLibrary } from './library'
import { readJson } from './library-input'
import { consumeSlots, type SlotRule } from './rate-limits'
import { HANDLE_SHAPE } from './sharing'

export const FRIEND_REQUEST_LIMITS = {
  perSender: { window: 60 * 60, max: 20 },
  perPair: { window: 30 * 24 * 60 * 60, max: 3 }
} satisfies Record<string, SlotRule>

async function friendRequesterKey(secret: string, userId: string): Promise<string> {
  return `friend-requester|${await keyedHash(secret, 'friend-requester-limit', userId)}`
}

async function friendPairKey(secret: string, fromId: string, toId: string) {
  return `friend-pair|${await keyedHash(secret, 'friend-pair-limit', `${fromId}\0${toId}`)}`
}

function handleIn(value: string): string | null {
  const handle = normalizeHandle(value)
  return HANDLE_SHAPE.test(handle) ? handle : null
}

type FriendRequestRefusal =
  | 'no_such_handle'
  | 'own_handle'
  | 'no_handle'
  | 'already_requested'
  | 'already_friends'
  | 'too_many_requests'

type FriendRequestResult = { sent: 'requested' | 'friends' } | { refused: FriendRequestRefusal }

async function settleRequest(
  db: Database,
  fromId: string,
  toId: string,
  now: Date
): Promise<FriendRequestResult> {
  const after = await friendState(db, fromId, toId)
  if (after === 'friends') return { refused: 'already_friends' }
  if (after === 'asked' && (await acceptFriendRequest(db, fromId, toId, now))) {
    return { sent: 'friends' }
  }
  return { refused: 'already_requested' }
}

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
  return settleRequest(db, fromId, toId, now)
}

const REFUSED_STATUS = {
  no_handle: 409,
  no_such_handle: 404,
  own_handle: 400,
  already_requested: 409,
  already_friends: 409,
  too_many_requests: 429
} as const

export async function listFriends(db: Database, user: SessionUser) {
  const [handle, lists] = await Promise.all([handleOf(db, user.id), friendLists(db, user.id)])
  return Response.json({ handle, ...lists })
}

const FRIEND_REQUEST = z.object({ handle: z.string() })

export async function sendFriendRequest(
  db: Database,
  user: SessionUser,
  request: Request,
  secret: string
): Promise<Response> {
  const wrong = wrongLibrary(user, request)
  if (wrong) return wrong
  const body = await readJson(request, FRIEND_REQUEST)
  if (body instanceof Response) return body
  const result = await requestFriend(db, user.id, body.json.handle, secret)
  if ('refused' in result) return apiError(REFUSED_STATUS[result.refused], result.refused)
  return Response.json({ state: result.sent }, { status: result.sent === 'requested' ? 201 : 200 })
}

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

export async function friendStatus(db: Database, user: SessionUser, handle: string) {
  const other = await otherUser(db, user, handle)
  if (other instanceof Response) return other
  const state: FriendState | 'own' =
    'own' in other ? 'own' : await friendState(db, user.id, other.otherId)
  return Response.json({ state })
}

const FRIEND_ACTION = z.object({ action: z.enum(['accept', 'decline', 'cancel', 'remove']) })

type FriendAction = z.infer<typeof FRIEND_ACTION>['action']

function act(db: Database, action: FriendAction, userId: string, otherId: string) {
  switch (action) {
    case 'accept':
      return acceptFriendRequest(db, userId, otherId, new Date())
    case 'decline':
      return deleteFriendRequest(db, otherId, userId)
    case 'cancel':
      return deleteFriendRequest(db, userId, otherId)
    case 'remove':
      return removeFriend(db, userId, otherId)
  }
}

export async function actOnFriend(
  db: Database,
  user: SessionUser,
  handle: string,
  request: Request
): Promise<Response> {
  const wrong = wrongLibrary(user, request)
  if (wrong) return wrong
  const body = await readJson(request, FRIEND_ACTION)
  if (body instanceof Response) return body
  const other = await otherUser(db, user, handle)
  if (other instanceof Response) return other
  if ('own' in other) return apiError(400, 'own_handle')
  if (!(await act(db, body.json.action, user.id, other.otherId))) return notFound()
  return Response.json({ state: await friendState(db, user.id, other.otherId) })
}
