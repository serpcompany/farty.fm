import { env } from 'cloudflare:test'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import type { Kind } from '@/db/library'
import { recordings, toots } from '@/db/schema'
import { maximumTakeSeconds } from '@/lib/recordings'
import {
  api,
  bucketKeys,
  media,
  padTootMetadata,
  recordingMetadata,
  signUp,
  testDb,
  tootMetadata,
  uploadBody,
  wav
} from '@/test-support/library-api'

// The library routes in workerd, with a real D1 and R2: uploads, the limits, deletes and their
// tombstones, renames, and one user never reaching another's Recordings or Toots.

// Saving a Toot is paid for everywhere (ADR 0010, #258), which `payments.workers.test.ts` tests.
// Here a Toot saves free, as wherever `savingIsPaid` says saving is free (`free` in `stripe.ts`).
vi.mock('@/server/toot-payments', async original => ({
  ...(await original<typeof import('@/server/toot-payments')>()),
  requestPayments: () => ({ kind: 'free' })
}))

const R1 = '11111111-1111-4111-8111-111111111111'
const R2 = '22222222-2222-4222-8222-222222222222'
const T1 = '33333333-3333-4333-8333-333333333333'
const MiB = 1024 * 1024

const metadata = (kind: Kind, id: string, fields: Record<string, unknown> = {}) =>
  kind === 'recordings' ? recordingMetadata(id, fields) : tootMetadata(id, fields)

async function upload(kind: Kind, id: string, cookie: string, audio = wav()) {
  return api.put(kind, id, uploadBody(metadata(kind, id), audio), { cookie })
}

async function audioOf(response: Response) {
  return new Uint8Array(await response.arrayBuffer())
}

type Library = {
  cursor: number
  full: boolean
  recordings: { id: string; number: number; analysis?: unknown }[]
  toots: { id: string; title: string }[]
  deleted: { recordings: string[]; toots: string[] }
}

async function library(cookie: string, since?: number): Promise<Library> {
  const response = await api.library({ cookie }, since)
  expect(response.status).toBe(200)
  return response.json()
}

const DAY = 24 * 60 * 60 * 1000
const OLD = '44444444-4444-4444-8444-444444444444'
const RECENT = '55555555-5555-4555-8555-555555555555'

/** A tombstone straight into D1, deleted `age` milliseconds ago by D1's clock. */
async function deletedAgo(kind: Kind, userId: string, id: string, age: number) {
  const at = `cast(unixepoch('subsec') * 1000 as integer) - ?3`
  const sql =
    kind === 'recordings'
      ? `insert into recordings (user_id, id, number, created_at, seconds, sample_rate, waveform,
          analysis, audio_bytes, updated_at, deleted_at)
         values (?1, ?2, 1, 0, 0.1, 48000, '[]', null, 100, ${at}, ${at})`
      : `insert into toots (user_id, id, title, song_id, created_at, seconds, arrangement,
          audio_bytes, updated_at, deleted_at)
         values (?1, ?2, '', 'twinkle', 0, 0.1, '{"transposition":0,"recordingForPitch":{}}', 100,
          ${at}, ${at})`
  await env.DB.prepare(sql).bind(userId, id, age).run()
}

/** Every row of `kind`, tombstones included, as "{user id} {id}", sorted. */
async function rowsOf(kind: Kind): Promise<string[]> {
  const { results } = await env.DB.prepare(`select user_id, id from ${kind}`).all<{
    user_id: string
    id: string
  }>()
  return results.map(row => `${row.user_id} ${row.id}`).sort()
}

/** Lets D1's clock move on, so the next change is after the last cursor. */
const tick = () => new Promise(resolve => setTimeout(resolve, 5))

/** Adds `count` live Recordings or Toots for the user straight into D1, with no audio. */
async function seed(kind: Kind, userId: string, count: number) {
  const columns =
    kind === 'recordings'
      ? `user_id, id, number, created_at, seconds, sample_rate, waveform, analysis, audio_bytes, updated_at`
      : `user_id, id, title, song_id, created_at, seconds, arrangement, audio_bytes, updated_at`
  const values =
    kind === 'recordings'
      ? `?1, printf('00000000-0000-4000-9000-%012d', i), i, 0, 0.1, 48000, '[]', null, 100, 0`
      : `?1, printf('00000000-0000-4000-9000-%012d', i), 'Seeded', 'twinkle', 0, 0.1, '{"transposition":0,"recordingForPitch":{}}', 100, 0`
  await env.DB.prepare(
    `with recursive n(i) as (select 1 union all select i + 1 from n where i < ?2)
     insert into ${kind} (${columns}) select ${values} from n`
  )
    .bind(userId, count)
    .run()
}

describe.each<Kind>(['recordings', 'toots'])('PUT /api/%s/{id}/', kind => {
  it('keeps the item, its WAV under the user’s own prefix, and lists it', async () => {
    const a = await signUp('A')
    const audio = wav(0.25)

    const put = await upload(kind, R1, a.cookie, audio)

    expect(put.status).toBe(201)
    expect(await put.json()).toEqual({ id: R1 })
    expect(await bucketKeys()).toEqual([`users/${a.id}/${kind}/${R1}.wav`])
    const listed = await library(a.cookie)
    // A Recording sent without a Placed Pitch is listed as left out (ADR 0015).
    const left = kind === 'recordings' ? { placedPitch: null } : {}
    expect(listed[kind]).toEqual([{ ...metadata(kind, R1), ...left, audioBytes: audio.byteLength }])
    const played = await api.audio(kind, R1, a)
    expect(played.status).toBe(200)
    expect(played.headers.get('content-type')).toBe('audio/wav')
    expect(await audioOf(played)).toEqual(audio)
  })

  it('changes nothing when an upload is retried (200)', async () => {
    const a = await signUp('A')
    const first = wav(0.1)
    await upload(kind, R1, a.cookie, first)

    const again = await api.put(
      kind,
      R1,
      uploadBody(metadata(kind, R1, { seconds: 0.2 }), wav(0.2)),
      a
    )

    expect(again.status).toBe(200)
    expect(await audioOf(await api.audio(kind, R1, a))).toEqual(first)
    expect((await library(a.cookie))[kind]).toMatchObject([{ id: R1, seconds: 0.1 }])
  })

  it('keeps one item when two uploads of it race (201, then 200)', async () => {
    const a = await signUp('A')

    const responses = await Promise.all([
      upload(kind, R1, a.cookie, wav(0.1)),
      upload(kind, R1, a.cookie, wav(0.1))
    ])

    expect(responses.map(response => response.status).sort()).toEqual([200, 201])
    expect(await bucketKeys()).toEqual([`users/${a.id}/${kind}/${R1}.wav`])
    expect((await library(a.cookie))[kind]).toHaveLength(1)
  })

  it('refuses an id that is not a UUID (404), so it never names a key', async () => {
    const a = await signUp('A')

    const response = await upload(kind, '..%2F..%2Fother', a.cookie)

    expect(response.status).toBe(404)
    expect(await bucketKeys()).toEqual([])
  })

  it('refuses a body that is not the upload form (415, 400)', async () => {
    const a = await signUp('A')
    const json = await api.put(kind, R1, JSON.stringify(metadata(kind, R1)), a, {
      headers: { 'content-type': 'application/json' }
    })
    const form = new FormData()
    form.set('metadata', JSON.stringify(metadata(kind, R1)))
    const noAudio = await api.put(kind, R1, form, a)
    const badJson = new FormData()
    badJson.set('metadata', '{')
    badJson.set('audio', new Blob([wav() as Uint8Array<ArrayBuffer>]), 'a.wav')
    const unparsable = await api.put(kind, R1, badJson, a)
    const wrongId = await api.put(kind, R1, uploadBody(metadata(kind, R2), wav()), a)

    expect(json.status).toBe(415)
    expect([noAudio.status, unparsable.status, wrongId.status]).toEqual([400, 400, 400])
    expect(await bucketKeys()).toEqual([])
    expect((await library(a.cookie))[kind]).toEqual([])
  })
})

describe('one user never reaches another’s Recordings or Toots', () => {
  it('answers 404 to user B for user A’s rows and audio, and B’s uploads stay B’s', async () => {
    const a = await signUp('A')
    const b = await signUp('B')
    const aRecording = wav(0.1)
    const aToot = wav(0.2)
    await upload('recordings', R1, a.cookie, aRecording)
    await upload('toots', T1, a.cookie, aToot)

    const reads = [await api.audio('recordings', R1, b), await api.audio('toots', T1, b)]
    const writes = [
      await api.delete('recordings', R1, b),
      await api.delete('toots', T1, b),
      await api.rename(T1, 'Mine now', b)
    ]
    const overwrite = await upload('recordings', R1, b.cookie, wav(0.3))

    expect(reads.map(response => response.status)).toEqual([404, 404])
    expect(writes.map(response => response.status)).toEqual([404, 404, 404])
    // B's upload with A's id is B's own Recording, under B's own prefix.
    expect(overwrite.status).toBe(201)
    expect(await bucketKeys(`users/${a.id}/`)).toEqual([
      `users/${a.id}/recordings/${R1}.wav`,
      `users/${a.id}/toots/${T1}.wav`
    ])
    expect(await audioOf(await api.audio('recordings', R1, a))).toEqual(aRecording)
    expect(await audioOf(await api.audio('toots', T1, a))).toEqual(aToot)
    const aLibrary = await library(a.cookie)
    expect(aLibrary.recordings).toMatchObject([{ id: R1, seconds: 0.1 }])
    expect(aLibrary.toots).toMatchObject([{ id: T1, title: 'Twinkle Twinkle Little Star' }])
    const bLibrary = await library(b.cookie)
    expect(bLibrary.recordings).toMatchObject([{ id: R1, audioBytes: wav(0.3).byteLength }])
    expect(bLibrary.toots).toEqual([])
  })

  it('leaves user A’s Recording when user B deletes the same id of their own', async () => {
    const a = await signUp('A')
    const b = await signUp('B')
    await upload('recordings', R1, a.cookie)
    await upload('recordings', R1, b.cookie)

    expect((await api.delete('recordings', R1, b)).status).toBe(204)

    expect((await api.audio('recordings', R1, a)).status).toBe(200)
    expect((await library(a.cookie)).deleted.recordings).toEqual([])
    expect((await api.audio('recordings', R1, b)).status).toBe(404)
  })
})

describe('every library request names its library’s account', () => {
  const upload = (cookie: string, library: string) =>
    api.put('recordings', R1, uploadBody(recordingMetadata(R1), wav()), { cookie, library })

  it('refuses an upload that names another account (409), and keeps nothing', async () => {
    const a = await signUp('A')
    const b = await signUp('B')

    const refused = await upload(a.cookie, b.id)

    expect(refused.status).toBe(409)
    expect(await refused.json()).toEqual({ error: 'wrong_account' })
    expect(await bucketKeys()).toEqual([])
    expect((await library(a.cookie)).recordings).toEqual([])
    expect((await library(b.cookie)).recordings).toEqual([])
    expect((await upload(a.cookie, a.id)).status).toBe(201)
  })

  // Another tab's sign-in changed the cookie to B's while A's library still sends what it queued.
  it('refuses a read, delete, rename or download that names another account, and changes nothing', async () => {
    const a = await signUp('A')
    const b = await signUp('B')
    await upload(b.cookie, b.id)
    await api.put('toots', T1, uploadBody(tootMetadata(T1), wav()), { cookie: b.cookie })
    const asA = { cookie: b.cookie, library: a.id }

    for (const refused of [
      await api.library(asA),
      await api.delete('recordings', R1, asA),
      await api.delete('toots', T1, asA),
      await api.rename(T1, 'Not B’s', asA),
      await api.audio('recordings', R1, asA)
    ]) {
      expect(refused.status).toBe(409)
      expect(await refused.json()).toEqual({ error: 'wrong_account' })
    }
    const kept = await library(b.cookie)
    expect(kept.recordings).toMatchObject([{ id: R1 }])
    expect(kept.toots).toMatchObject([{ id: T1, title: 'Twinkle Twinkle Little Star' }])
    expect(kept.deleted).toEqual({ recordings: [], toots: [] })

    // Naming B's own library, each goes through.
    const asB = { cookie: b.cookie, library: b.id }
    expect((await api.library(asB)).status).toBe(200)
    expect((await api.audio('recordings', R1, asB)).status).toBe(200)
    expect((await api.rename(T1, 'B’s', asB)).status).toBe(200)
    expect((await api.delete('recordings', R1, asB)).status).toBe(204)
  })
})

describe('the limits', () => {
  it.each<[Kind, number]>([
    ['recordings', 6 * MiB],
    ['toots', 16 * MiB]
  ])('keeps a %s WAV of %i bytes and refuses one a sample larger (413)', async (kind, limit) => {
    const a = await signUp('A')
    const atLimit = wav((limit - 44) / 2 / 48_000)
    const overLimit = wav((limit - 44 + 2) / 2 / 48_000)
    expect([atLimit.byteLength, overLimit.byteLength]).toEqual([limit, limit + 2])

    const over = await api.put(
      kind,
      R1,
      uploadBody(metadata(kind, R1, { seconds: 1 }), overLimit),
      a
    )
    const at = await api.put(kind, R2, uploadBody(metadata(kind, R2, { seconds: 1 }), atLimit), a)

    expect(over.status).toBe(413)
    expect(at.status).toBe(201)
    expect(await bucketKeys()).toEqual([`users/${a.id}/${kind}/${R2}.wav`])
  })

  it('keeps a 30 s Recording at 96 kHz (201)', async () => {
    const a = await signUp('A')
    const audio = wav(maximumTakeSeconds, 96_000)
    expect(audio.byteLength).toBe(5_760_044)

    const response = await api.put(
      'recordings',
      R1,
      uploadBody(recordingMetadata(R1, { seconds: maximumTakeSeconds, sampleRate: 96_000 }), audio),
      a
    )

    expect(response.status).toBe(201)
    expect(await bucketKeys()).toEqual([`users/${a.id}/recordings/${R1}.wav`])
  })

  it('stops reading a body larger than the WAV limit and the form around it (413)', async () => {
    const a = await signUp('A')
    // Over a Recording's 6 MiB and the 64 KiB allowed for the form around it.
    const response = await api.put('recordings', R1, new Uint8Array(7 * MiB), a, {
      headers: { 'content-type': 'multipart/form-data; boundary=x' }
    })

    expect(response.status).toBe(413)
  })

  it.each<Kind>([
    'recordings',
    'toots'
  ])('keeps 300 %s per account, and only 300 when uploads race (409)', async kind => {
    const a = await signUp('A')
    const b = await signUp('B')
    await seed(kind, a.id, 297)
    // B's count is B's own.
    await seed(kind, b.id, 300)
    const ids = Array.from(
      { length: 6 },
      (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`
    )

    const responses = await Promise.all(ids.map(id => upload(kind, id, a.cookie)))

    const statuses = responses.map(response => response.status).sort()
    expect(statuses).toEqual([201, 201, 201, 409, 409, 409])
    expect((await library(a.cookie))[kind]).toHaveLength(300)
    // The refused uploads' audio isn't left behind.
    expect(await bucketKeys(`users/${a.id}/`)).toHaveLength(3)
    expect(await (await upload(kind, R1, b.cookie)).json()).toEqual({ error: 'limit_reached' })
  })

  it.each<Kind>([
    'recordings',
    'toots'
  ])('counts only live %s: a delete makes room again', async kind => {
    const a = await signUp('A')
    await seed(kind, a.id, 299)
    await upload(kind, R1, a.cookie)
    expect((await upload(kind, R2, a.cookie)).status).toBe(409)

    await api.delete(kind, R1, a)

    expect((await upload(kind, R2, a.cookie)).status).toBe(201)
    // A second delete leaves two tombstones, and still makes room.
    await api.delete(kind, R2, a)
    expect((await upload(kind, T1, a.cookie)).status).toBe(201)
  })
})

describe('the WAV check', () => {
  it.each([
    ['not a WAV', new TextEncoder().encode('RIFF....WAVEnot really audio at all, just text')],
    ['a header with no samples', wav(0)],
    ['a WAV cut short', wav(0.1).subarray(0, 1000)]
  ])('refuses %s (400), and keeps nothing', async (_, audio) => {
    const a = await signUp('A')

    const response = await upload('recordings', R1, a.cookie, audio)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_audio' })
    expect(await bucketKeys()).toEqual([])
    expect((await library(a.cookie)).recordings).toEqual([])
  })

  it('refuses a Recording whose sample rate is not its WAV’s (400)', async () => {
    const a = await signUp('A')

    const response = await api.put(
      'recordings',
      R1,
      uploadBody(recordingMetadata(R1, { sampleRate: 44_100 }), wav(0.1, 48_000)),
      a
    )

    expect(response.status).toBe(400)
    expect(await bucketKeys()).toEqual([])
  })
})

describe('deletes and GET /api/library/?since=', () => {
  it('leaves a tombstone that later reads list, deletes the WAV, and refuses the id again', async () => {
    const a = await signUp('A')
    await upload('recordings', R1, a.cookie)
    await upload('recordings', R2, a.cookie)
    await upload('toots', T1, a.cookie)
    // The cursor counts whole milliseconds and `since` includes its own millisecond, so a change
    // in the same millisecond as the cursor comes back again. Wait, so this read sees none.
    await tick()
    const first = await library(a.cookie)
    expect(first.recordings.map(r => r.id).sort()).toEqual([R1, R2])
    expect(first.deleted).toEqual({ recordings: [], toots: [] })
    await tick()

    expect((await api.delete('recordings', R1, a)).status).toBe(204)
    expect((await api.delete('toots', T1, a)).status).toBe(204)

    const changes = await library(a.cookie, first.cursor)
    expect(changes.recordings).toEqual([])
    expect(changes.toots).toEqual([])
    expect(changes.deleted).toEqual({ recordings: [R1], toots: [T1] })
    expect(changes.cursor).toBeGreaterThanOrEqual(first.cursor)
    // A browser that has never read the library sees only what is live, and the tombstones.
    const everything = await library(a.cookie)
    expect(everything.recordings.map(r => r.id)).toEqual([R2])
    expect(everything.deleted).toEqual({ recordings: [R1], toots: [T1] })
    expect(await bucketKeys()).toEqual([`users/${a.id}/recordings/${R2}.wav`])
    expect((await api.audio('recordings', R1, a)).status).toBe(404)
    // The Toot's title, the one thing a user types, is gone with it.
    const [tombstone] = await testDb()
      .select()
      .from(toots)
      .where(and(eq(toots.userId, a.id), eq(toots.id, T1)))
    expect(tombstone.title).toBe('')
    // An upload of a deleted id, from a browser that hasn't heard yet, is refused.
    expect((await upload('recordings', R1, a.cookie)).status).toBe(410)
    expect((await upload('toots', T1, a.cookie)).status).toBe(410)
    expect(await bucketKeys()).toEqual([`users/${a.id}/recordings/${R2}.wav`])
  })

  it('answers a repeated delete (204), and an unknown id with 404', async () => {
    const a = await signUp('A')
    await upload('recordings', R1, a.cookie)
    await api.delete('recordings', R1, a)

    expect((await api.delete('recordings', R1, a)).status).toBe(204)
    expect((await api.delete('recordings', R2, a)).status).toBe(404)
  })

  it('lists only what changed since the cursor', async () => {
    const a = await signUp('A')
    await upload('recordings', R1, a.cookie)
    // R1 in the cursor's own millisecond would come back again (by design: never missed).
    await tick()
    const first = await library(a.cookie)
    await tick()

    const unchanged = await library(a.cookie, first.cursor)
    await upload('recordings', R2, a.cookie)
    const changed = await library(a.cookie, first.cursor)

    expect(unchanged.recordings).toEqual([])
    expect(changed.recordings.map(r => r.id)).toEqual([R2])
  })

  it('purges tombstones older than 30 days at the next delete, and keeps newer and others’', async () => {
    const a = await signUp('A')
    const b = await signUp('B')
    await deletedAgo('recordings', a.id, OLD, 31 * DAY)
    await deletedAgo('toots', a.id, OLD, 31 * DAY)
    await deletedAgo('recordings', a.id, RECENT, 29 * DAY)
    await deletedAgo('recordings', b.id, OLD, 31 * DAY)
    await upload('recordings', R1, a.cookie)

    expect((await api.delete('recordings', R1, a)).status).toBe(204)

    expect(await rowsOf('recordings')).toEqual([
      `${a.id} ${R1}`,
      `${a.id} ${RECENT}`,
      `${b.id} ${OLD}`
    ])
    expect(await rowsOf('toots')).toEqual([])
  })

  it('says a read is the whole library when its since is older than tombstones are kept', async () => {
    const a = await signUp('A')
    const { cursor, full } = await library(a.cookie)

    expect(full).toBe(true)
    expect((await library(a.cookie, cursor - 30 * DAY - 1000)).full).toBe(true)
    expect((await library(a.cookie, cursor - 30 * DAY + 60_000)).full).toBe(false)
    expect((await library(a.cookie, cursor)).full).toBe(false)
  })

  it('refuses a since that is not epoch milliseconds (400)', async () => {
    const a = await signUp('A')

    const responses = await Promise.all(
      ['-1', 'yesterday', '1e9', '9'.repeat(16)].map(since => api.library(a, since))
    )

    expect(responses.map(response => response.status)).toEqual([400, 400, 400, 400])
  })
})

describe('PATCH /api/toots/{id}/', () => {
  it('renames a Toot, and the last rename to arrive wins', async () => {
    const a = await signUp('A')
    await upload('toots', T1, a.cookie)
    const before = await library(a.cookie)
    await tick()

    const first = await api.rename(T1, '  Bean Song  ', a)
    const second = await api.rename(T1, 'Gas Symphony', a)

    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ id: T1, title: 'Bean Song' })
    expect(second.status).toBe(200)
    const changes = await library(a.cookie, before.cursor)
    expect(changes.toots).toMatchObject([{ id: T1, title: 'Gas Symphony' }])
  })

  it('refuses an empty title (400), a deleted Toot (410) and an unknown one (404)', async () => {
    const a = await signUp('A')
    await upload('toots', T1, a.cookie)

    const empty = await api.rename(T1, '   ', a)
    const long = await api.rename(T1, 'x'.repeat(201), a)
    await api.delete('toots', T1, a)
    const deleted = await api.rename(T1, 'Too late', a)
    const unknown = await api.rename(R1, 'Nothing here', a)

    expect([empty.status, long.status, deleted.status, unknown.status]).toEqual([
      400, 400, 410, 404
    ])
  })
})

describe('PATCH /api/recordings/{id}/ (ADR 0015)', () => {
  it('places a Recording on a note, moves it and takes it off, keeping its analysis', async () => {
    const a = await signUp('A')
    await upload('recordings', R1, a.cookie)
    const before = await library(a.cookie)
    await tick()

    const placed = await api.place(R1, 36, a)
    expect(placed.status).toBe(200)
    expect(await placed.json()).toEqual({ id: R1, placedPitch: 36 })
    const changes = await library(a.cookie, before.cursor)
    expect(changes.recordings).toEqual([
      { ...before.recordings[0], placedPitch: 36, audioBytes: expect.any(Number) }
    ])

    expect((await api.place(R1, 71, a)).status).toBe(200)
    expect((await library(a.cookie)).recordings).toMatchObject([{ id: R1, placedPitch: 71 }])
    const off = await api.place(R1, null, a)
    expect(await off.json()).toEqual({ id: R1, placedPitch: null })
    const [row] = await testDb().select().from(recordings).where(eq(recordings.userId, a.id))
    expect(row.placedPitch).toBeNull()
    expect(row.analysis).toEqual(recordingMetadata(R1).analysis.analysis)
  })

  it('refuses a note that is not a MIDI note (400), a deleted Recording (410), an unknown one (404) and another library (409)', async () => {
    const a = await signUp('A')
    const b = await signUp('B')
    await upload('recordings', R1, a.cookie)

    for (const placedPitch of ['C2', 48.5, -1, 128, undefined]) {
      const refused = await api.place(R1, placedPitch, a)
      expect(refused.status, String(placedPitch)).toBe(400)
      expect(await refused.json()).toEqual({ error: 'invalid_request' })
    }
    expect((await api.place(R1, 48, a, 'not json')).status).toBe(400)
    const asB = await api.place(R1, 48, { cookie: a.cookie, library: b.id })
    expect(asB.status).toBe(409)
    expect((await api.place(R1, 48, b)).status).toBe(404)
    expect((await api.place('not-a-uuid', 48, a)).status).toBe(404)
    expect((await library(a.cookie)).recordings).toMatchObject([{ id: R1, placedPitch: null }])
    await api.delete('recordings', R1, a)
    expect((await api.place(R1, 48, a)).status).toBe(410)
    expect((await api.place(R2, 48, a)).status).toBe(404)
  })
})

describe('writes from another site', () => {
  it('are refused (403) and change nothing, even with the session cookie', async () => {
    const a = await signUp('A')
    await upload('recordings', R1, a.cookie)
    await upload('toots', T1, a.cookie)
    const elsewhere = { cookie: a.cookie, origin: 'https://evil.example' }
    const noOrigin = { cookie: a.cookie, origin: null }

    const responses = [
      await api.put('recordings', R2, uploadBody(recordingMetadata(R2), wav()), elsewhere),
      await api.put('recordings', R2, uploadBody(recordingMetadata(R2), wav()), noOrigin),
      await api.delete('recordings', R1, elsewhere),
      await api.delete('toots', T1, noOrigin),
      await api.rename(T1, 'Hijacked', elsewhere),
      await api.patchAccount({ marketingEmail: false }, elsewhere),
      await api.deleteAccount(elsewhere),
      await api.deleteAccount(noOrigin)
    ]

    expect(responses.map(response => response.status)).toEqual([
      403, 403, 403, 403, 403, 403, 403, 403
    ])
    expect(await responses[0].json()).toEqual({ error: 'cross_origin' })
    const after = await library(a.cookie)
    expect(after.recordings.map(r => r.id)).toEqual([R1])
    expect(after.toots).toMatchObject([{ id: T1, title: 'Twinkle Twinkle Little Star' }])
    expect(after.deleted).toEqual({ recordings: [], toots: [] })
    expect(await bucketKeys()).toEqual([
      `users/${a.id}/recordings/${R1}.wav`,
      `users/${a.id}/toots/${T1}.wav`
    ])
  })

  it('does not stop a read without an Origin', async () => {
    const a = await signUp('A')

    expect((await api.library({ cookie: a.cookie, origin: null })).status).toBe(200)
  })
})

describe('caching', () => {
  it('marks every answer private and no-store', async () => {
    const a = await signUp('A')
    const responses = [
      await upload('recordings', R1, a.cookie),
      await upload('recordings', R1, a.cookie),
      await upload('recordings', R2, a.cookie, new Uint8Array(100)),
      await api.library(a),
      await api.audio('recordings', R1, a),
      await api.audio('recordings', R2, a),
      await api.delete('recordings', R1, a),
      await api.patchAccount({ marketingEmail: false }, a),
      await api.deleteAccount({ cookie: a.cookie, origin: 'https://evil.example' })
    ]

    expect(responses.map(response => response.status)).toEqual([
      201, 200, 400, 200, 200, 404, 204, 200, 403
    ])
    for (const response of responses) {
      expect(response.headers.get('cache-control')).toBe('private, no-store')
    }
  })
})

describe('the rows a route keeps', () => {
  it('are the browser’s Recording, with the audio’s size from R2', async () => {
    const a = await signUp('A')
    const audio = wav(0.1, 44_100)

    await api.put(
      'recordings',
      R1,
      uploadBody(
        recordingMetadata(R1, { sampleRate: 44_100, analysis: { state: 'notAnalyzed' } }),
        audio
      ),
      a
    )

    const [row] = await testDb().select().from(recordings).where(eq(recordings.userId, a.id))
    expect(row).toMatchObject({ id: R1, sampleRate: 44_100, analysis: null, deletedAt: null })
    expect(row.audioBytes).toBe((await media().head(`users/${a.id}/recordings/${R1}.wav`))?.size)
    expect((await library(a.cookie)).recordings).toMatchObject([
      { id: R1, analysis: { state: 'notAnalyzed' } }
    ])
  })

  it('keep the settle time (#116), and none when an older browser sends none', async () => {
    const a = await signUp('A')
    const R3 = '66666666-6666-4666-8666-666666666666'
    const analysis = (fields: Record<string, unknown>) => ({
      state: 'analyzed',
      analysis: { ...recordingMetadata(R1).analysis.analysis, ...fields }
    })
    for (const [id, fields] of [
      [R1, { settleSeconds: 0.087 }],
      [R2, {}]
    ] as const) {
      const response = await api.put(
        'recordings',
        id,
        uploadBody(recordingMetadata(id, { analysis: analysis(fields) }), wav()),
        a
      )
      expect(response.status).toBe(201)
    }
    const kept = new Map((await library(a.cookie)).recordings.map(r => [r.id, r.analysis]))
    expect(kept.get(R1)).toEqual(analysis({ settleSeconds: 0.087 }))
    expect(kept.get(R2)).toEqual(analysis({}))
    expect(kept.get(R2)).not.toHaveProperty('analysis.settleSeconds')

    // Not a number, negative, or longer than any Recording (3600 s).
    for (const settleSeconds of ['0.1', -0.001, 3600.001]) {
      const refused = await api.put(
        'recordings',
        R3,
        uploadBody(recordingMetadata(R3, { analysis: analysis({ settleSeconds }) }), wav()),
        a
      )
      expect(refused.status).toBe(400)
      expect(await refused.json()).toEqual({ error: 'invalid_request' })
    }
    expect(await rowsOf('recordings')).toEqual([`${a.id} ${R1}`, `${a.id} ${R2}`])
  })

  it('keep the Placed Pitch (ADR 0015), and none when an older browser sends none', async () => {
    const a = await signUp('A')
    const R3 = '66666666-6666-4666-8666-666666666666'
    for (const [id, fields] of [
      [R1, { placedPitch: 40 }],
      [R2, {}]
    ] as const) {
      const response = await api.put(
        'recordings',
        id,
        uploadBody(recordingMetadata(id, fields), wav()),
        a
      )
      expect(response.status).toBe(201)
    }
    const kept = new Map((await library(a.cookie)).recordings.map(r => [r.id, r]))
    expect(kept.get(R1)).toMatchObject({ placedPitch: 40 })
    expect(kept.get(R2)).toMatchObject({ placedPitch: null })

    for (const placedPitch of ['40', 40.5, 128]) {
      const refused = await api.put(
        'recordings',
        R3,
        uploadBody(recordingMetadata(R3, { placedPitch }), wav()),
        a
      )
      expect(refused.status).toBe(400)
      expect(await refused.json()).toEqual({ error: 'invalid_request' })
    }
    expect(await rowsOf('recordings')).toEqual([`${a.id} ${R1}`, `${a.id} ${R2}`])
  })

  it('keep the analysis version (#208), and none when an older browser sends none', async () => {
    const a = await signUp('A')
    const R3 = '66666666-6666-4666-8666-666666666666'
    const analysis = (fields: Record<string, unknown>) => ({
      state: 'analyzed',
      analysis: { ...recordingMetadata(R1).analysis.analysis, ...fields }
    })
    for (const [id, fields] of [
      [R1, { settleSeconds: 0.087, version: 3 }],
      [R2, { settleSeconds: 0.087 }]
    ] as const) {
      const response = await api.put(
        'recordings',
        id,
        uploadBody(recordingMetadata(id, { analysis: analysis(fields) }), wav()),
        a
      )
      expect(response.status).toBe(201)
    }
    const kept = new Map((await library(a.cookie)).recordings.map(r => [r.id, r.analysis]))
    expect(kept.get(R1)).toEqual(analysis({ settleSeconds: 0.087, version: 3 }))
    expect(kept.get(R2)).not.toHaveProperty('analysis.version')

    // Not a whole number from 1 to 1000.
    for (const version of ['3', 0, 2.5, 1001]) {
      const refused = await api.put(
        'recordings',
        R3,
        uploadBody(recordingMetadata(R3, { analysis: analysis({ version }) }), wav()),
        a
      )
      expect(refused.status).toBe(400)
      expect(await refused.json()).toEqual({ error: 'invalid_request' })
    }
    expect(await rowsOf('recordings')).toEqual([`${a.id} ${R1}`, `${a.id} ${R2}`])
  })
})

describe('Sound Pad Toots (ADR 0016)', () => {
  const pad = padTootMetadata(T1)
  const { performance } = pad
  const put = (metadata: unknown, cookie: string, id = T1) =>
    api.put('toots', id, uploadBody(metadata, wav()), { cookie })

  it('keep no Song and no Arrangement, and their Performance, as the browser sent them', async () => {
    const a = await signUp('A')
    expect((await put(pad, a.cookie)).status).toBe(201)
    const [row] = await testDb().select().from(toots).where(eq(toots.userId, a.id))
    expect(row).toMatchObject({ songId: null, arrangement: null, performance })
    expect((await library(a.cookie)).toots).toEqual([{ ...pad, audioBytes: row.audioBytes }])
  })

  it('keep only a Performance’s own fields', async () => {
    const a = await signUp('A')
    const more = { ...performance, more: 'x'.repeat(1000) }
    expect((await put(padTootMetadata(T1, { performance: more }), a.cookie)).status).toBe(201)
    const [row] = await testDb().select().from(toots).where(eq(toots.userId, a.id))
    expect(row.performance).toEqual(performance)
  })

  it('keep a Performance of 1000 taps, and one 30 s long', async () => {
    const a = await signUp('A')
    const taps = Array.from({ length: 1000 }, (_, i) => [i * 0.03, i % 2])
    const many = padTootMetadata(T1, { performance: { ...performance, taps } })
    expect((await put(many, a.cookie)).status).toBe(201)
    const T2 = '44444444-4444-4444-8444-444444444444'
    const long = padTootMetadata(T2, {
      performance: {
        ...performance,
        taps: [
          [0, 0],
          [30, 1]
        ]
      }
    })
    expect((await put(long, a.cookie, T2)).status).toBe(201)
  })

  it('refuse a Toot of both or neither, and a Performance this app can’t play (400)', async () => {
    const a = await signUp('A')
    const [r1, r2] = performance.recordings
    const playing = (fields: Record<string, unknown>) =>
      padTootMetadata(T1, { performance: { ...performance, ...fields } })
    const taps = (...list: unknown[]) => playing({ taps: list })
    const refused = [
      // A Song's Toot with a Performance, a Sound Pad's with an Arrangement, or with neither.
      tootMetadata(T1, { performance }),
      padTootMetadata(T1, { arrangement: tootMetadata(T1).arrangement }),
      padTootMetadata(T1, { performance: null }),
      padTootMetadata(T1, { songId: undefined }),
      // No Recordings or taps, or a Recording that isn't one, or is there twice.
      playing({ recordings: [], taps: [] }),
      taps(),
      playing({ recordings: ['not-a-recording', r2] }),
      playing({ recordings: [r1, r1] }),
      // Taps out of order, before the start, past 30 s, or of a Recording it doesn't name.
      taps([0.5, 0], [0.25, 1]),
      taps([-0.001, 0], [0, 1]),
      taps([0, 0], [30.001, 1]),
      taps([0, 0], [0.25, 2]),
      taps([0, 0], [0.25, 0.5]),
      taps([0, 0], [0.25, 1, 2]),
      taps([0, 0], ['0.25', 1]),
      // A Recording it names and never plays, or more than 1000 taps.
      taps([0, 0], [0.25, 0]),
      playing({ taps: Array.from({ length: 1001 }, (_, i) => [i * 0.01, i % 2]) })
    ]
    for (const metadata of refused) {
      const response = await put(metadata, a.cookie)
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'invalid_request' })
    }
    expect(await rowsOf('toots')).toEqual([])
  })
})
