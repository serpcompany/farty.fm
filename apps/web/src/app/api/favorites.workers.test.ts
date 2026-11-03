import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import { FAVORITE_SONGS_LIMIT } from '@/server/library'
import { api, nextD1Millisecond, signUp } from '@/test-support/library-api'

type Library = {
  cursor: number
  full: boolean
  favorites: string[]
  deleted: { favorites: string[] }
}

async function library(as: { cookie: string }, since?: number): Promise<Library> {
  const response = await api.library(as, since)
  expect(response.status).toBe(200)
  return response.json()
}

const DAY = 24 * 60 * 60 * 1000

async function rows(): Promise<string[]> {
  const { results } = await env.DB.prepare(
    'select user_id, song_id, deleted_at from favorite_songs'
  ).all<{ user_id: string; song_id: string; deleted_at: number | null }>()
  return results
    .map(row => `${row.user_id} ${row.song_id} ${row.deleted_at === null ? 'live' : 'deleted'}`)
    .sort()
}

describe('PUT /api/favorites/{songId}/', () => {
  it('marks a Song (201), changes nothing when it already is (200), and lists it', async () => {
    const a = await signUp('A')

    const first = await api.favorite('twinkle', a)
    expect(first.status).toBe(201)
    expect(await first.json()).toEqual({ songId: 'twinkle' })
    expect((await api.favorite('twinkle', a)).status).toBe(200)
    expect((await api.favorite('mary', a)).status).toBe(201)

    const read = await library(a)
    expect(read.favorites.sort()).toEqual(['mary', 'twinkle'])
    expect(read.deleted.favorites).toEqual([])
    expect(await rows()).toEqual([`${a.id} mary live`, `${a.id} twinkle live`])
  })

  it('refuses an id no Song could have (404)', async () => {
    const a = await signUp('A')
    for (const id of ['', 'a b', 'x'.repeat(101), '../toots']) {
      expect((await api.favorite(encodeURIComponent(id), a)).status).toBe(404)
    }
    expect(await rows()).toEqual([])
  })

  it('stops at the limit (409), and still answers a Song already marked', async () => {
    const a = await signUp('A')
    await env.DB.prepare(
      `with recursive n(i) as (select 1 union all select i + 1 from n where i < ?2)
       insert into favorite_songs (user_id, song_id, created_at, updated_at)
       select ?1, 'song-' || i, 0, 0 from n`
    )
      .bind(a.id, FAVORITE_SONGS_LIMIT)
      .run()

    const over = await api.favorite('twinkle', a)
    expect(over.status).toBe(409)
    expect(await over.json()).toEqual({ error: 'limit_reached' })
    expect((await api.favorite('song-1', a)).status).toBe(200)

    expect((await api.unfavorite('song-1', a)).status).toBe(204)
    expect((await api.favorite('twinkle', a)).status).toBe(201)
  })
})

describe('DELETE /api/favorites/{songId}/', () => {
  it('leaves a tombstone that later reads list, and a favorite again clears it', async () => {
    const a = await signUp('A')
    await api.favorite('twinkle', a)
    await api.favorite('mary', a)
    const { cursor } = await library(a)
    await nextD1Millisecond()

    expect((await api.unfavorite('twinkle', a)).status).toBe(204)

    const since = await library(a, cursor)
    expect(since.favorites).toEqual([])
    expect(since.deleted.favorites).toEqual(['twinkle'])
    expect(await rows()).toEqual([`${a.id} mary live`, `${a.id} twinkle deleted`])
    const all = await library(a)
    expect(all.favorites).toEqual(['mary'])

    await nextD1Millisecond()
    expect((await api.favorite('twinkle', a)).status).toBe(201)
    const again = await library(a, since.cursor)
    expect(again.favorites).toEqual(['twinkle'])
    expect(again.deleted.favorites).toEqual([])
  })

  it('answers 204 for a Song that was never a favorite, or already taken off, and keeps nothing', async () => {
    const a = await signUp('A')

    expect((await api.unfavorite('twinkle', a)).status).toBe(204)
    expect(await rows()).toEqual([])
    await api.favorite('mary', a)
    expect((await api.unfavorite('mary', a)).status).toBe(204)
    expect((await api.unfavorite('mary', a)).status).toBe(204)
    expect(await rows()).toEqual([`${a.id} mary deleted`])
  })

  it('purges tombstones older than 30 days, and keeps newer and others’', async () => {
    const a = await signUp('A')
    const b = await signUp('B')
    const at = `cast(unixepoch('subsec') * 1000 as integer) - ?3`
    const tombstone = (userId: string, songId: string, age: number) =>
      env.DB.prepare(
        `insert into favorite_songs (user_id, song_id, created_at, updated_at, deleted_at)
         values (?1, ?2, 0, ${at}, ${at})`
      )
        .bind(userId, songId, age)
        .run()
    await tombstone(a.id, 'old', 31 * DAY)
    await tombstone(a.id, 'recent', 29 * DAY)
    await tombstone(b.id, 'old', 31 * DAY)

    await api.unfavorite('twinkle', a)

    expect(await rows()).toEqual([`${a.id} recent deleted`, `${b.id} old deleted`])
  })
})

describe('one user’s Favorite Songs', () => {
  it('are never another’s to read or take off', async () => {
    const a = await signUp('A')
    const b = await signUp('B')
    await api.favorite('twinkle', a)

    expect((await library(b)).favorites).toEqual([])
    expect((await api.unfavorite('twinkle', b)).status).toBe(204)
    expect((await library(a)).favorites).toEqual(['twinkle'])
  })

  it('are refused for a request naming another account’s library (409)', async () => {
    const a = await signUp('A')
    const b = await signUp('B')

    const put = await api.favorite('twinkle', { ...a, library: b.id })
    expect(put.status).toBe(409)
    expect(await put.json()).toEqual({ error: 'wrong_account' })
    await api.favorite('mary', a)
    expect((await api.unfavorite('mary', { ...a, library: b.id })).status).toBe(409)
    expect(await rows()).toEqual([`${a.id} mary live`])
  })

  it('refuse a write from another site (403) or with no session (401)', async () => {
    const a = await signUp('A')

    expect((await api.favorite('twinkle', { ...a, origin: 'https://evil.example' })).status).toBe(
      403
    )
    expect((await api.favorite('twinkle', {})).status).toBe(401)
    expect((await api.unfavorite('twinkle', {})).status).toBe(401)
    expect(await rows()).toEqual([])
  })

  it('go with the account when it is deleted', async () => {
    const a = await signUp('A')
    await api.favorite('twinkle', a)

    expect((await api.deleteAccount(a)).status).toBe(204)

    expect(await rows()).toEqual([])
  })
})

describe('the library read', () => {
  it('lists every live Favorite Song in a full read, and only what changed since a cursor', async () => {
    const a = await signUp('A')
    await api.favorite('twinkle', a)
    const { cursor, full, favorites } = await library(a)
    expect(full).toBe(true)
    expect(favorites).toEqual(['twinkle'])
    await nextD1Millisecond()

    await api.favorite('mary', a)

    expect((await library(a, cursor)).favorites).toEqual(['mary'])
  })

  it('lists, after a browser was away longer than tombstones are kept, those marked before', async () => {
    const a = await signUp('A')
    await api.favorite('twinkle', a)
    await env.DB.prepare(
      'update favorite_songs set updated_at = updated_at - ?1, created_at = created_at - ?1'
    )
      .bind(40 * DAY)
      .run()
    const { cursor } = await library(a)

    const away = await library(a, cursor - 31 * DAY)
    expect(away.full).toBe(true)
    expect(away.favorites).toEqual(['twinkle'])
  })
})
