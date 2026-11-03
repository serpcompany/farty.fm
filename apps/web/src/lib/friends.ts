import { answer, send } from './library-api'

export type FriendState = 'none' | 'requested' | 'asked' | 'friends' | 'own'

export type Friends = {
  handle: string | null
  requests: string[]
  friends: string[]
  sent: string[]
}

export async function readFriends(accountId: string): Promise<Friends | null> {
  const response = await send('/api/friends/', accountId)
  if (!response?.ok) return null
  return response.json()
}

export async function readFriendState(
  handle: string,
  accountId: string
): Promise<FriendState | null> {
  const response = await send(`/api/friends/${encodeURIComponent(handle)}/`, accountId)
  if (!response?.ok) return null
  return ((await response.json()) as { state: FriendState }).state
}

export type RequestRefusal =
  | 'no_such_handle'
  | 'own_handle'
  | 'no_handle'
  | 'already_requested'
  | 'already_friends'
  | 'too_many_requests'
  | 'failed'

const REFUSALS: readonly string[] = [
  'no_such_handle',
  'own_handle',
  'no_handle',
  'already_requested',
  'already_friends',
  'too_many_requests'
]

export async function requestFriend(
  handle: string,
  accountId: string
): Promise<{ state: 'requested' | 'friends' } | { refused: RequestRefusal }> {
  const response = await send('/api/friends/', accountId, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ handle })
  })
  if (response?.ok) return response.json()
  const { error } = await answer(response)
  return { refused: error && REFUSALS.includes(error) ? (error as RequestRefusal) : 'failed' }
}

export type FriendAction = 'accept' | 'decline' | 'cancel' | 'remove'

export async function actOnFriend(
  handle: string,
  action: FriendAction,
  accountId: string
): Promise<FriendState | 'gone' | null> {
  const response = await send(`/api/friends/${encodeURIComponent(handle)}/`, accountId, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action })
  })
  if (response?.ok) return ((await response.json()) as { state: FriendState }).state
  return response?.status === 404 ? 'gone' : null
}
