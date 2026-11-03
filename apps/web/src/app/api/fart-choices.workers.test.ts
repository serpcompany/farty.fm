import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import type { FartChoices } from '@/lib/engine/fart-choices'
import { FART_CHOICES_LIMIT } from '@/server/library'
import { api, signUp } from '@/test-support/library-api'

// Fart Choices (#360) in workerd, with a real D1: `PUT` and `DELETE /api/fart-choices/{songId}/`,
// their tombstones, the library read that brings them to other browsers, and one user never
// reaching another's.

type Library = {
  cursor: number
  full: boolean
  fartChoices: { songId: string; choices: FartChoices }[]
  deleted: { fartChoices: string[] }
}

async function library(as: { cookie: string }, since?: number): Promise<Library> {
  const response = await api.library(as, since)
  expect(response.status).toBe(200)
  return response.json()
}

/** Lets D1's clock move on, so the next change is after the last cursor. */
const tick = () => new Promise(resolve => setTimeout(resolve, 5))

const DAY = 24 * 60 * 60 * 1000

const R1 = '00000000-0000-4000-8000-000000000001'
const R2 = '00000000-0000-4000-8000-000000000002'

const swapped: FartChoices = { transposition: -12, preferred: { 60: R1 }, excluded: [] }
const leftOut: FartChoices = { transposition: -12, preferred: {}, excluded: [R2] }

/** Every row, tombstones included, as "{user id} {song id} {live|deleted}", sorted. */
async function rows(): Promise<string[]> {
  const { results } = await env.DB.prepare(
    'select user_id, song_id, deleted_at from fart_choices'
  ).all<{ user_id: string; song_id: string; deleted_at: number | null }>()
  return results
    .map(row => `${row.user_id} ${row.song_id} ${row.deleted_at === null ? 'live' : 'deleted'}`)
    .sort()
}

describe('PUT /api/fart-choices/{songId}/', () => {
  it('keeps a Song’s Choices, replaces them, and lists them', async () => {
    const a = await signUp('A')

    const first = await api.setFartChoices('twinkle', swapped, a)
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ songId: 'twinkle', choices: swapped })
    expect((await api.setFartChoices('twinkle', leftOut, a)).status).toBe(200)
    expect((await api.setFartChoices('mary', swapped, a)).status).toBe(200)

    const read = await library(a)
    expect(read.fartChoices.sort((x, y) => x.songId.localeCompare(y.songId))).toEqual([
      { songId: 'mary', choices: swapped },
      { songId: 'twinkle', choices: leftOut }
    ])
    expect(read.deleted.fartChoices).toEqual([])
    expect(await rows()).toEqual([`${a.id} mary live`, `${a.id} twinkle live`])
  })

  it('keeps them in order: picks by pitch, left out sorted and once', async () => {
    const a = await signUp('A')
    const messy = { transposition: 0, preferred: { 67: R2, 60: R1 }, excluded: [R2, R1, R2] }

    const answer = await api.setFartChoices('twinkle', messy, a)

    expect(await answer.json()).toEqual({
      songId: 'twinkle',
      choices: { transposition: 0, preferred: { 60: R1, 67: R2 }, excluded: [R1, R2] }
    })
  })

  it('refuses Choices that aren’t any (400) and an id no Song could have (404)', async () => {
    const a = await signUp('A')
    const refused = [
      null,
      [],
      { transposition: 0, preferred: {}, excluded: [] },
      { transposition: 0.5, preferred: { 60: R1 }, excluded: [] },
      { transposition: 25, preferred: { 60: R1 }, excluded: [] },
      { transposition: -37, preferred: { 60: R1 }, excluded: [] },
      { transposition: 0, preferred: { 128: R1 }, excluded: [] },
      { transposition: 0, preferred: { '-1': R1 }, excluded: [] },
      { transposition: 0, preferred: { c4: R1 }, excluded: [] },
      { transposition: 0, preferred: { 60: 'a b' }, excluded: [] },
      { transposition: 0, preferred: [R1], excluded: [] },
      { transposition: 0, preferred: {}, excluded: [7] },
      { transposition: 0, preferred: {}, excluded: Array.from({ length: 301 }, (_, i) => `r${i}`) }
    ]
    for (const choices of refused) {
      expect((await api.setFartChoices('twinkle', choices, a)).status).toBe(400)
    }
    expect((await api.setFartChoices('twinkle', null, a, '{')).status).toBe(400)
    for (const id of ['', 'a b', 'x'.repeat(101), '../toots']) {
      expect((await api.setFartChoices(encodeURIComponent(id), swapped, a)).status).toBe(404)
    }
    expect(await rows()).toEqual([])
  })

  it('stops at the limit (409), and still changes a Song that has Choices', async () => {
    const a = await signUp('A')
    await env.DB.prepare(
      `with recursive n(i) as (select 1 union all select i + 1 from n where i < ?2)
       insert into fart_choices (user_id, song_id, choices, created_at, updated_at)
       select ?1, 'song-' || i, ?3, 0, 0 from n`
    )
      .bind(a.id, FART_CHOICES_LIMIT, JSON.stringify(swapped))
      .run()

    const over = await api.setFartChoices('twinkle', swapped, a)
    expect(over.status).toBe(409)
    expect(await over.json()).toEqual({ error: 'limit_reached' })
    expect((await api.setFartChoices('song-1', leftOut, a)).status).toBe(200)

    // One made automatic makes room again.
    expect((await api.clearFartChoices('song-1', a)).status).toBe(204)
    expect((await api.setFartChoices('twinkle', swapped, a)).status).toBe(200)
  })
})

describe('DELETE /api/fart-choices/{songId}/', () => {
  it('leaves a tombstone that later reads list, and new Choices clear it', async () => {
    const a = await signUp('A')
    await api.setFartChoices('twinkle', swapped, a)
    await api.setFartChoices('mary', swapped, a)
    const { cursor } = await library(a)
    await tick()

    expect((await api.clearFartChoices('twinkle', a)).status).toBe(204)

    const since = await library(a, cursor)
    expect(since.fartChoices).toEqual([])
    expect(since.deleted.fartChoices).toEqual(['twinkle'])
    expect(await rows()).toEqual([`${a.id} mary live`, `${a.id} twinkle deleted`])
    expect((await library(a)).fartChoices).toEqual([{ songId: 'mary', choices: swapped }])

    await tick()
    expect((await api.setFartChoices('twinkle', leftOut, a)).status).toBe(200)
    const again = await library(a, since.cursor)
    expect(again.fartChoices).toEqual([{ songId: 'twinkle', choices: leftOut }])
    expect(again.deleted.fartChoices).toEqual([])
  })

  it('answers 204 for a Song that had none, or was made automatic already', async () => {
    const a = await signUp('A')

    expect((await api.clearFartChoices('twinkle', a)).status).toBe(204)
    expect(await rows()).toEqual([])
    await api.setFartChoices('mary', swapped, a)
    expect((await api.clearFartChoices('mary', a)).status).toBe(204)
    expect((await api.clearFartChoices('mary', a)).status).toBe(204)
    expect(await rows()).toEqual([`${a.id} mary deleted`])
  })

  it('purges tombstones older than 30 days, and keeps newer and others’', async () => {
    const a = await signUp('A')
    const b = await signUp('B')
    const at = `cast(unixepoch('subsec') * 1000 as integer) - ?3`
    const tombstone = (userId: string, songId: string, age: number) =>
      env.DB.prepare(
        `insert into fart_choices (user_id, song_id, created_at, updated_at, deleted_at)
         values (?1, ?2, 0, ${at}, ${at})`
      )
        .bind(userId, songId, age)
        .run()
    await tombstone(a.id, 'old', 31 * DAY)
    await tombstone(a.id, 'recent', 29 * DAY)
    await tombstone(b.id, 'old', 31 * DAY)

    await api.clearFartChoices('twinkle', a)

    expect(await rows()).toEqual([`${a.id} recent deleted`, `${b.id} old deleted`])
  })
})

describe('one user’s Fart Choices', () => {
  it('are never another’s to read or change', async () => {
    const a = await signUp('A')
    const b = await signUp('B')
    await api.setFartChoices('twinkle', swapped, a)

    expect((await library(b)).fartChoices).toEqual([])
    expect((await api.clearFartChoices('twinkle', b)).status).toBe(204)
    expect((await library(a)).fartChoices).toEqual([{ songId: 'twinkle', choices: swapped }])
  })

  it('are refused for a request naming another account’s library (409)', async () => {
    const a = await signUp('A')
    const b = await signUp('B')

    const put = await api.setFartChoices('twinkle', swapped, { ...a, library: b.id })
    expect(put.status).toBe(409)
    expect(await put.json()).toEqual({ error: 'wrong_account' })
    await api.setFartChoices('mary', swapped, a)
    expect((await api.clearFartChoices('mary', { ...a, library: b.id })).status).toBe(409)
    expect(await rows()).toEqual([`${a.id} mary live`])
  })

  it('refuse a write from another site (403) or with no session (401)', async () => {
    const a = await signUp('A')

    const evil = { ...a, origin: 'https://evil.example' }
    expect((await api.setFartChoices('twinkle', swapped, evil)).status).toBe(403)
    expect((await api.setFartChoices('twinkle', swapped, {})).status).toBe(401)
    expect((await api.clearFartChoices('twinkle', {})).status).toBe(401)
    expect(await rows()).toEqual([])
  })

  it('go with the account when it is deleted', async () => {
    const a = await signUp('A')
    await api.setFartChoices('twinkle', swapped, a)

    expect((await api.deleteAccount(a)).status).toBe(204)

    expect(await rows()).toEqual([])
  })
})

describe('the library read', () => {
  it('lists every Song’s Choices in a full read, and only what changed since a cursor', async () => {
    const a = await signUp('A')
    await api.setFartChoices('twinkle', swapped, a)
    const { cursor, full, fartChoices } = await library(a)
    expect(full).toBe(true)
    expect(fartChoices).toEqual([{ songId: 'twinkle', choices: swapped }])
    await tick()

    await api.setFartChoices('mary', leftOut, a)

    expect((await library(a, cursor)).fartChoices).toEqual([{ songId: 'mary', choices: leftOut }])
  })

  it('lists, after a browser was away longer than tombstones are kept, those kept before', async () => {
    const a = await signUp('A')
    await api.setFartChoices('twinkle', swapped, a)
    await env.DB.prepare(
      'update fart_choices set updated_at = updated_at - ?1, created_at = created_at - ?1'
    )
      .bind(40 * DAY)
      .run()
    const { cursor } = await library(a)

    const away = await library(a, cursor - 31 * DAY)
    expect(away.full).toBe(true)
    expect(away.fartChoices).toEqual([{ songId: 'twinkle', choices: swapped }])
  })
})
