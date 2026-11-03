import { answer, send } from './library-api'

// Friends from the browser (#319, ADR 0021), through `src/app/api/friends/`
// (`src/server/friends.ts`). Each call names the account the library is, as every library call
// does.

/** How the user stands with another: as `FriendState` on the server, or their own page. */
export type FriendState = 'none' | 'requested' | 'asked' | 'friends' | 'own'

/** The user's Handle, who asked them, their friends and whom they asked, each newest first. */
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

/** How the user stands with `handle`, or null when no one has it or Farty couldn't be reached. */
export async function readFriendState(
  handle: string,
  accountId: string
): Promise<FriendState | null> {
  const response = await send(`/api/friends/${encodeURIComponent(handle)}/`, accountId)
  if (!response?.ok) return null
  return ((await response.json()) as { state: FriendState }).state
}

/** Why a request wasn't sent: as the server's codes, or `failed` when Farty couldn't be reached. */
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

/**
 * Asks the user with `handle` to be friends: `requested`, or `friends` when they'd already asked,
 * which accepts theirs.
 */
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

/**
 * Accepts or declines `handle`'s request, cancels the user's to them, or removes them as a friend:
 * the state after, `gone` when there was nothing to act on (another device already did), or null
 * when Farty couldn't be reached.
 */
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
