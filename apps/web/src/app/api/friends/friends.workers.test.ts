import { eq, like } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import * as handleRoute from '@/app/api/handle/route'
import { addFriendRequest, type FriendLists } from '@/db/friends'
import { friendRequests, friends, rateLimit } from '@/db/schema'
import { FRIEND_REQUEST_LIMITS, requestFriend } from '@/server/friends'
import { type As, api, ORIGIN, signUp, testDb } from '@/test-support/library-api'

import * as friendRoute from './[handle]/route'
import * as friendsRoute from './route'

// Friends (#319, ADR 0021) in workerd, with a real D1: requests by Handle, accepting, declining,
// cancelling and removing, and that each acts only between the signed-in user and the Handle in
// it, so no one reaches a request or friendship that isn't theirs.

const params = <P>(value: P) => ({ params: Promise.resolve(value) })

function request(path: string, method: string, as: As, body?: unknown) {
  const headers = new Headers()
  if (as.cookie) headers.set('cookie', as.cookie)
  if (as.library) headers.set('x-pedos-library', as.library)
  const origin = as.origin === undefined ? (method === 'GET' ? null : ORIGIN) : as.origin
  if (origin !== null) headers.set('origin', origin)
  if (body !== undefined) headers.set('content-type', 'application/json')
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  })
}

const friend = {
  list: async (as: As) =>
    (await (
      await friendsRoute.GET(request('/api/friends/', 'GET', as), params({}))
    ).json()) as FriendLists & { handle: string | null },
  ask: (handle: unknown, as: As) =>
    friendsRoute.POST(request('/api/friends/', 'POST', as, { handle }), params({})),
  state: async (handle: string, as: As) => {
    const response = await friendRoute.GET(
      request(`/api/friends/${handle}/`, 'GET', as),
      params({ handle })
    )
    return { status: response.status, ...((await response.json()) as object) }
  },
  act: (handle: string, action: unknown, as: As) =>
    friendRoute.POST(request(`/api/friends/${handle}/`, 'POST', as, { action }), params({ handle }))
}

/** A user with an account and the Handle `name`. */
async function member(name: string) {
  const user = await signUp(name)
  const picked = await handleRoute.PUT(
    request('/api/handle/', 'PUT', user, { handle: name }),
    params({})
  )
  expect(picked.status).toBe(201)
  return user
}

const body = async (response: Response) => ({
  status: response.status,
  ...((await response.json()) as object)
})

/** Alice has asked Bob. */
async function aliceAskedBob() {
  const alice = await member('alice')
  const bob = await member('bob')
  expect(await body(await friend.ask('bob', alice))).toEqual({ status: 201, state: 'requested' })
  return { alice, bob }
}

/** Alice and Bob are friends. */
async function aliceAndBob() {
  const { alice, bob } = await aliceAskedBob()
  expect(await body(await friend.act('alice', 'accept', bob))).toEqual({
    status: 200,
    state: 'friends'
  })
  return { alice, bob }
}

const requestRows = () =>
  testDb()
    .select({ from: friendRequests.fromUserId, to: friendRequests.toUserId })
    .from(friendRequests)
const friendRows = () =>
  testDb().select({ user: friends.userId, friend: friends.friendId }).from(friends)

describe('Sending a friend request', () => {
  it('asks the user with that Handle, who sees who asked', async () => {
    const { alice, bob } = await aliceAskedBob()
    expect(await friend.list(alice)).toEqual({
      handle: 'alice',
      requests: [],
      friends: [],
      sent: ['bob']
    })
    expect(await friend.list(bob)).toEqual({
      handle: 'bob',
      requests: ['alice'],
      friends: [],
      sent: []
    })
    expect(await friend.state('bob', alice)).toEqual({ status: 200, state: 'requested' })
    expect(await friend.state('alice', bob)).toEqual({ status: 200, state: 'asked' })
    expect(await requestRows()).toEqual([{ from: 'useralice', to: 'userbob' }])
  })

  it('takes the Handle as typed: an @, capitals and spaces', async () => {
    const alice = await member('alice')
    await member('bob')
    expect((await friend.ask(' @Bob ', alice)).status).toBe(201)
  })

  it('refuses a Handle no one has, and one that could be no one’s', async () => {
    const alice = await member('alice')
    for (const handle of ['carol', 'ab', 'a-b', 'x'.repeat(21), '']) {
      expect(await body(await friend.ask(handle, alice))).toEqual({
        status: 404,
        error: 'no_such_handle'
      })
    }
    expect(await body(await friend.ask(42, alice))).toEqual({
      status: 400,
      error: 'invalid_request'
    })
    expect(await requestRows()).toEqual([])
  })

  it('refuses your own Handle', async () => {
    const alice = await member('alice')
    expect(await body(await friend.ask('alice', alice))).toEqual({
      status: 400,
      error: 'own_handle'
    })
    expect(await friend.state('alice', alice)).toEqual({ status: 200, state: 'own' })
  })

  it('refuses asking twice, and asking a friend', async () => {
    const { alice, bob } = await aliceAskedBob()
    expect(await body(await friend.ask('bob', alice))).toEqual({
      status: 409,
      error: 'already_requested'
    })
    await friend.act('alice', 'accept', bob)
    expect(await body(await friend.ask('bob', alice))).toEqual({
      status: 409,
      error: 'already_friends'
    })
    expect(await body(await friend.ask('alice', bob))).toEqual({
      status: 409,
      error: 'already_friends'
    })
  })

  it('needs a Handle of your own first, since whoever you ask sees you by it', async () => {
    const alice = await signUp('alice')
    await member('bob')
    expect(await body(await friend.ask('bob', alice))).toEqual({
      status: 409,
      error: 'no_handle'
    })
    expect(await requestRows()).toEqual([])
  })

  it('accepts their request when they asked first', async () => {
    const { alice, bob } = await aliceAskedBob()
    expect(await body(await friend.ask('alice', bob))).toEqual({ status: 200, state: 'friends' })
    expect(await requestRows()).toEqual([])
    expect((await friend.list(alice)).friends).toEqual(['bob'])
  })

  it('is refused from another site, or as another account’s library', async () => {
    const alice = await member('alice')
    await member('bob')
    expect((await friend.ask('bob', { ...alice, origin: 'https://evil.example' })).status).toBe(403)
    expect(await body(await friend.ask('bob', { ...alice, library: 'userbob' }))).toEqual({
      status: 409,
      error: 'wrong_account'
    })
    expect(await requestRows()).toEqual([])
  })

  it('keeps a few to the same person, so a decline can’t start a stream', async () => {
    const { alice, bob } = await aliceAskedBob()
    for (let i = 1; i < FRIEND_REQUEST_LIMITS.perPair.max; i++) {
      expect((await friend.act('alice', 'decline', bob)).status).toBe(200)
      expect((await friend.ask('bob', alice)).status).toBe(201)
    }
    await friend.act('alice', 'decline', bob)
    expect(await body(await friend.ask('bob', alice))).toEqual({
      status: 429,
      error: 'too_many_requests'
    })
    // Someone else is a pair of its own.
    await member('carol')
    expect((await friend.ask('carol', alice)).status).toBe(201)
  })

  it('keeps a few an hour per sender, keyed by an HMAC, and a refused one spends nothing', async () => {
    const { alice } = await aliceAskedBob()
    const sender = await testDb()
      .select({ key: rateLimit.key, count: rateLimit.count })
      .from(rateLimit)
      .where(like(rateLimit.key, 'friend-requester|%'))
    expect(sender).toEqual([
      { key: expect.stringMatching(/^friend-requester\|[0-9a-f]{64}$/), count: 1 }
    ])
    expect(sender[0].key).not.toContain('useralice')
    await testDb().update(rateLimit).set({ count: FRIEND_REQUEST_LIMITS.perSender.max })

    await member('carol')
    expect(await body(await friend.ask('carol', alice))).toEqual({
      status: 429,
      error: 'too_many_requests'
    })
    expect(
      await testDb()
        .select({ key: rateLimit.key })
        .from(rateLimit)
        .where(like(rateLimit.key, 'friend-pair|%'))
    ).toHaveLength(1)
    expect(await requestRows()).toEqual([{ from: 'useralice', to: 'userbob' }])
  })

  it('keeps the same-person limit for 30 days, not one', async () => {
    const alice = await member('alice')
    const bob = await member('bob')
    const start = Date.now()
    const at = (days: number) => new Date(start + days * 24 * 60 * 60 * 1000)
    const ask = (days: number) =>
      requestFriend(testDb(), 'useralice', 'bob', 'test-secret', at(days))
    for (let i = 0; i < FRIEND_REQUEST_LIMITS.perPair.max; i++) {
      expect(await ask(0)).toEqual({ sent: 'requested' })
      expect((await friend.act('alice', 'decline', bob)).status).toBe(200)
    }
    expect(await ask(1)).toEqual({ refused: 'too_many_requests' })
    expect(await ask(29)).toEqual({ refused: 'too_many_requests' })
    expect(await ask(30.01)).toEqual({ sent: 'requested' })
    expect(await friend.state('bob', alice)).toEqual({ status: 200, state: 'requested' })
  })
})

describe('Two users asking each other', () => {
  it('can’t leave a request each way: the second insert sees the first', async () => {
    const alice = await member('alice')
    const bob = await member('bob')
    expect((await friend.ask('alice', bob)).status).toBe(201)
    expect(await addFriendRequest(testDb(), 'useralice', 'userbob', new Date())).toBe(false)
    expect(await requestRows()).toEqual([{ from: 'userbob', to: 'useralice' }])
    expect(await friend.state('bob', alice)).toEqual({ status: 200, state: 'asked' })
  })

  it('end as friends when they ask at once', async () => {
    const alice = await member('alice')
    const bob = await member('bob')
    const [a, b] = await Promise.all([friend.ask('bob', alice), friend.ask('alice', bob)])
    expect([a.status, b.status].sort()).toEqual([200, 201])
    expect(await requestRows()).toEqual([])
    expect(await friendRows()).toHaveLength(2)
  })
})

describe('Answering a friend request', () => {
  it('makes friends both ways when accepted, and clears the request', async () => {
    const { alice, bob } = await aliceAndBob()
    expect(await requestRows()).toEqual([])
    expect(await friendRows()).toEqual(
      expect.arrayContaining([
        { user: 'useralice', friend: 'userbob' },
        { user: 'userbob', friend: 'useralice' }
      ])
    )
    expect(await friend.list(alice)).toMatchObject({ requests: [], friends: ['bob'], sent: [] })
    expect(await friend.list(bob)).toMatchObject({ requests: [], friends: ['alice'], sent: [] })
    expect(await friend.state('alice', bob)).toEqual({ status: 200, state: 'friends' })
  })

  it('tells no one when declined: the request is gone, and they can ask again', async () => {
    const { alice, bob } = await aliceAskedBob()
    expect(await body(await friend.act('alice', 'decline', bob))).toEqual({
      status: 200,
      state: 'none'
    })
    expect(await friend.list(alice)).toMatchObject({ sent: [], friends: [] })
    expect(await friend.state('bob', alice)).toEqual({ status: 200, state: 'none' })
    expect((await friend.ask('bob', alice)).status).toBe(201)
  })

  it('can be cancelled by its sender', async () => {
    const { alice, bob } = await aliceAskedBob()
    expect(await body(await friend.act('bob', 'cancel', alice))).toEqual({
      status: 200,
      state: 'none'
    })
    expect(await friend.list(bob)).toMatchObject({ requests: [] })
  })

  it('answers 404 when there’s nothing to act on, and 400 to an action it doesn’t know', async () => {
    const alice = await member('alice')
    await member('bob')
    for (const action of ['accept', 'decline', 'cancel', 'remove']) {
      expect(await body(await friend.act('bob', action, alice))).toEqual({
        status: 404,
        error: 'not_found'
      })
    }
    expect((await friend.act('bob', 'block', alice)).status).toBe(400)
    expect(await body(await friend.act('carol', 'accept', alice))).toEqual({
      status: 404,
      error: 'no_such_handle'
    })
    expect(await body(await friend.act('alice', 'accept', alice))).toEqual({
      status: 400,
      error: 'own_handle'
    })
  })
})

describe('Removing a friend', () => {
  it('ends the friendship for both, and tells no one', async () => {
    const { alice, bob } = await aliceAndBob()
    expect(await body(await friend.act('bob', 'remove', alice))).toEqual({
      status: 200,
      state: 'none'
    })
    expect(await friendRows()).toEqual([])
    expect((await friend.list(bob)).friends).toEqual([])
    expect(await friend.state('alice', bob)).toEqual({ status: 200, state: 'none' })
  })
})

describe('Someone else’s request or friendship', () => {
  it('can’t be accepted, declined, cancelled or removed by anyone else', async () => {
    const { alice, bob } = await aliceAskedBob()
    const carol = await member('carol')
    // Carol names Alice: only a request or friendship between Carol and Alice is reached.
    for (const action of ['accept', 'decline', 'cancel', 'remove']) {
      expect((await friend.act('alice', action, carol)).status).toBe(404)
      expect((await friend.act('bob', action, carol)).status).toBe(404)
    }
    // Nor can Alice accept her own request, or Bob cancel it as if it were his.
    expect((await friend.act('bob', 'accept', alice)).status).toBe(404)
    expect((await friend.act('alice', 'cancel', bob)).status).toBe(404)
    expect(await requestRows()).toEqual([{ from: 'useralice', to: 'userbob' }])

    await friend.act('alice', 'accept', bob)
    for (const action of ['accept', 'decline', 'cancel', 'remove']) {
      expect((await friend.act('alice', action, carol)).status).toBe(404)
      expect((await friend.act('bob', action, carol)).status).toBe(404)
    }
    expect(await friendRows()).toHaveLength(2)
    expect(await friend.list(carol)).toEqual({
      handle: 'carol',
      requests: [],
      friends: [],
      sent: []
    })
  })

  it('isn’t read by another account’s library', async () => {
    const { alice } = await aliceAskedBob()
    expect((await friend.act('bob', 'cancel', { ...alice, library: 'userbob' })).status).toBe(409)
    expect(await requestRows()).toHaveLength(1)
  })
})

describe('Deleting an account', () => {
  it('deletes its requests either way and its friendships', async () => {
    const { alice, bob } = await aliceAndBob()
    const carol = await member('carol')
    await member('dave')
    expect((await friend.ask('alice', carol)).status).toBe(201)
    expect((await friend.ask('dave', alice)).status).toBe(201)
    expect((await api.deleteAccount(alice)).status).toBe(204)
    expect(await requestRows()).toEqual([])
    expect(await friendRows()).toEqual([])
    expect((await friend.list(bob)).friends).toEqual([])
    expect(await friend.state('alice', bob)).toEqual({ status: 404, error: 'no_such_handle' })
  })
})

describe('The lists', () => {
  it('put the newest first', async () => {
    const alice = await member('alice')
    const others = new Map<string, As>()
    for (const [i, name] of ['bob', 'carol', 'dave'].entries()) {
      others.set(name, await member(name))
      expect((await friend.ask(name, alice)).status).toBe(201)
      // Minutes apart, as the order is by when each was sent.
      await testDb()
        .update(friendRequests)
        .set({ createdAt: new Date(Date.UTC(2026, 10, 1, 9, i)) })
        .where(eq(friendRequests.toUserId, `user${name}`))
    }
    expect((await friend.list(alice)).sent).toEqual(['dave', 'carol', 'bob'])
    expect((await friend.list(others.get('carol') as As)).requests).toEqual(['alice'])
  })

  it('leave out anyone in them whose account is gone', async () => {
    const { alice, bob } = await aliceAndBob()
    await api.deleteAccount(bob)
    expect(await friend.list(alice)).toMatchObject({ friends: [], requests: [], sent: [] })
  })
})
