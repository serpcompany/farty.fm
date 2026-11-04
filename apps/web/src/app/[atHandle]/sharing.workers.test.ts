import { eq, like } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import * as handleRoute from '@/app/api/handle/route'
import * as shareRecordingRoute from '@/app/api/share/recordings/[id]/route'
import * as sharesRoute from '@/app/api/share/route'
import * as shareTootRoute from '@/app/api/share/toots/[id]/route'
import type { Kind } from '@/db/library'
import { markTootPaid, startTootPayment } from '@/db/payments'
import { handles, rateLimit, shareReports, shares } from '@/db/schema'
import { TOOT_PRICE } from '@/lib/pricing'
import { encodeWav } from '@/lib/wav'
import {
  findSharedRecording,
  findSharedToot,
  partFrames,
  SHARED_TOOT_BARS,
  sharedAudioCacheKey,
  sharedPart,
  sharedTootKey,
  sharedTootLevels
} from '@/server/sharing'
import { readWavHeader } from '@/server/wav-header'
import {
  type As,
  api,
  media,
  ORIGIN,
  padTootMetadata,
  recordingMetadata,
  signUp,
  testDb,
  tootMetadata,
  uploadBody,
  wav
} from '@/test-support/library-api'

import * as audioRoute from './r/[id]/audio/route'
import * as imageRoute from './r/[id]/image/route'
import * as reportRoute from './r/[id]/report/route'
import * as tootAudioRoute from './t/[id]/audio/route'
import * as tootImageRoute from './t/[id]/image/route'
import * as tootReportRoute from './t/[id]/report/route'

// Sharing (ADR 0020) in workerd, with a real D1 and R2: Handles, sharing and stopping sharing a
// Recording or a saved Toot, its public audio and Report, and that a link works only while its
// item is shared, by its owner, under their Handle.

const R1 = '11111111-1111-4111-8111-111111111111'
const R2 = '22222222-2222-4222-8222-222222222222'
const T1 = '33333333-3333-4333-8333-333333333333'
const T2 = '44444444-4444-4444-8444-444444444444'

const params = <P>(value: P) => ({ params: Promise.resolve(value) })

function request(path: string, method: string, as: As, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  if (as.cookie) headers.set('cookie', as.cookie)
  if (as.library) headers.set('x-pedos-library', as.library)
  const origin = as.origin === undefined ? (method === 'GET' ? null : ORIGIN) : as.origin
  if (origin !== null) headers.set('origin', origin)
  return new Request(`${ORIGIN}${path}`, { ...init, method, headers })
}

const json = (body: unknown) => ({
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body)
})

const shareRoutes = { recordings: shareRecordingRoute, toots: shareTootRoute }
/** Each kind of link's public routes, by its segment: `r` for a Recording, `t` for a Toot. */
const linkRoutes = {
  r: { audio: audioRoute, image: imageRoute, report: reportRoute },
  t: { audio: tootAudioRoute, image: tootImageRoute, report: tootReportRoute }
}

const share = {
  handle: (as: As) => handleRoute.GET(request('/api/handle/', 'GET', as), params({})),
  check: (handle: string, as: As) =>
    handleRoute.GET(
      request(`/api/handle/?check=${encodeURIComponent(handle)}`, 'GET', as),
      params({})
    ),
  pick: (handle: unknown, as: As) =>
    handleRoute.PUT(request('/api/handle/', 'PUT', as, json({ handle })), params({})),
  list: (as: As) => sharesRoute.GET(request('/api/share/', 'GET', as), params({})),
  put: (id: string, as: As, kind: Kind = 'recordings') =>
    shareRoutes[kind].PUT(request(`/api/share/${kind}/${id}/`, 'PUT', as), params({ id })),
  stop: (id: string, as: As, kind: Kind = 'recordings') =>
    shareRoutes[kind].DELETE(request(`/api/share/${kind}/${id}/`, 'DELETE', as), params({ id })),
  /** The shared item's audio, as anyone with the link fetches it: no cookie. */
  audio: (url: string, init: RequestInit = {}) => {
    const { segment, atHandle, id } = linkParts(url)
    return linkRoutes[segment].audio.GET(
      new Request(`${url}audio/`, { ...init, method: 'GET' }),
      params({ atHandle, id })
    )
  },
  /** The shared item's link image, as a link preview fetches it. */
  image: (url: string) => {
    const { segment, atHandle, id } = linkParts(url)
    return linkRoutes[segment].image.GET(new Request(`${url}image/`), params({ atHandle, id }))
  },
  /** A report from the page, by the reporter at `ip`, or with no `cf-connecting-ip` when null. */
  report: (url: string, origin: string | null = ORIGIN, ip: string | null = '203.0.113.1') => {
    const { segment, atHandle, id } = linkParts(url)
    const headers = new Headers()
    if (ip !== null) headers.set('cf-connecting-ip', ip)
    if (origin !== null) headers.set('origin', origin)
    return linkRoutes[segment].report.POST(
      new Request(`${url}report/`, { method: 'POST', headers }),
      params({ atHandle, id })
    )
  }
}

/** The slots spent of `rate_limit`'s row `key`, or null when it has none. */
async function slots(key: string): Promise<number | null> {
  const [row] = await testDb()
    .select({ count: rateLimit.count })
    .from(rateLimit)
    .where(eq(rateLimit.key, key))
  return row?.count ?? null
}

/** The slots spent of each `rate_limit` row whose key is `LIKE` `pattern`. */
async function slotsLike(pattern: string): Promise<number[]> {
  const rows = await testDb()
    .select({ count: rateLimit.count })
    .from(rateLimit)
    .where(like(rateLimit.key, pattern))
  return rows.map(row => row.count)
}

/**
 * A link's parts: its kind's segment, its first segment (`@alice`, #382), the Handle that names,
 * and its id. Any first segment, so a test can try one with no `@`, or with it escaped.
 */
function linkParts(url: string): {
  segment: 'r' | 't'
  atHandle: string
  handle: string
  id: string
} {
  const match = new URL(url).pathname.match(/^\/([^/]+)\/(r|t)\/([^/]+)\/$/)
  if (!match) throw new Error(`Not a share link: ${url}`)
  return {
    segment: match[2] as 'r' | 't',
    atHandle: match[1],
    handle: decodeURIComponent(match[1]).replace(/^@/, ''),
    id: match[3]
  }
}

async function upload(id: string, cookie: string) {
  const response = await api.put('recordings', id, uploadBody(recordingMetadata(id), wav()), {
    cookie
  })
  expect(response.status).toBe(201)
}

/** A saved Toot's WAV: 0.1 s of a tone, so the bytes served are plainly the ones stored. */
function tootWav(): Uint8Array {
  const samples = Float32Array.from({ length: 4800 }, (_, i) => 0.5 * Math.sin(i / 10))
  return new Uint8Array(encodeWav({ samples, sampleRate: 48_000 }))
}

/** The Recording `tootMetadata`'s Arrangement plays. */
const tootRecording = '00000000-0000-0000-0000-000000000090'

/** A Sound Pad Performance that taps `recordingId` twice. */
const playing = (recordingId: string) => ({
  recordings: [recordingId],
  taps: [
    [0, 0],
    [0.25, 0]
  ]
})

/** Pays for the Toot `id`, as Checkout does (ADR 0010), without saving it. */
async function payFor(user: { id: string }, id: string, songId: string | null = 'twinkle') {
  await startTootPayment(testDb(), user.id, id, songId, `cs_test_${id}`, TOOT_PRICE)
  expect(await markTootPaid(testDb(), user.id, id, `cs_test_${id}`)).toBe(true)
}

/** Pays for the Toot `id` and saves it to the account, as Song Creator's Save does. */
async function saveToot(
  id: string,
  user: { id: string; cookie: string },
  audio = tootWav(),
  metadata: { songId: string | null } = tootMetadata(id)
) {
  await payFor(user, id, metadata.songId)
  const response = await api.put('toots', id, uploadBody(metadata, audio), user)
  expect(response.status).toBe(201)
}

/** A user with a Handle and a saved Toot `T1`, shared: its link. */
async function tootSharer(name: string) {
  const user = await signUp(name)
  expect((await share.pick(name, user)).status).toBe(201)
  await saveToot(T1, user)
  const response = await share.put(T1, user, 'toots')
  expect(response.status).toBe(201)
  const { url } = (await response.json()) as { url: string }
  return { ...user, url }
}

/** A user with a Handle and an uploaded Recording `R1`, shared: its link. */
async function sharer(name: string) {
  const user = await signUp(name)
  expect((await share.pick(name, user)).status).toBe(201)
  await upload(R1, user.cookie)
  const response = await share.put(R1, user)
  expect(response.status).toBe(201)
  const { url } = (await response.json()) as { url: string }
  return { ...user, url }
}

describe('Handles', () => {
  it('suggests one from the email, and checks each as it is typed', async () => {
    const alice = await signUp('alice')
    expect(await (await share.handle(alice)).json()).toEqual({ handle: null, suggestion: 'alice' })

    const problem = async (handle: string) =>
      ((await (await share.check(handle, alice)).json()) as { problem: string | null }).problem
    expect(await problem('ab')).toBe('short')
    expect(await problem('a'.repeat(21))).toBe('long')
    expect(await problem('a-b')).toBe('chars')
    expect(await problem('Farty')).toBe('blocked')
    expect(await problem('@Alice_1')).toBeNull()

    const bob = await signUp('bob')
    expect((await share.pick('alice_1', bob)).status).toBe(201)
    expect(await problem('alice_1')).toBe('taken')
  })

  it('is picked once, unique, and never one on the block list', async () => {
    const alice = await signUp('alice')
    const bob = await signUp('bob')

    const blocked = await share.pick('admin', alice)
    expect(blocked.status).toBe(400)
    expect(await blocked.json()).toEqual({ error: 'handle_unusable', problem: 'blocked' })
    expect((await share.pick(42, alice)).status).toBe(400)

    const picked = await share.pick('@Alice', alice)
    expect(picked.status).toBe(201)
    expect(await picked.json()).toEqual({ handle: 'alice' })
    expect(await (await share.handle(alice)).json()).toEqual({ handle: 'alice', suggestion: null })

    const again = await share.pick('alice2', alice)
    expect(again.status).toBe(409)
    expect(await again.json()).toEqual({ error: 'has_handle', handle: 'alice' })

    const taken = await share.pick('alice', bob)
    expect(taken.status).toBe(409)
    expect(await taken.json()).toEqual({ error: 'handle_taken' })
    // Someone else's email name isn't suggested once it's taken.
    const carol = await signUp('alice2')
    expect(((await (await share.handle(carol)).json()) as { suggestion: string }).suggestion).toBe(
      'alice2'
    )
  })

  it("can't hold an @ or a /, so a link's path names one Handle only (#382)", async () => {
    const alice = await signUp('alice')
    for (const handle of ['ali@ce', 'alice@', '@@alice', 'ali/ce', 'alice/', 'ali%40ce']) {
      const refused = await share.pick(handle, alice)
      expect(refused.status, handle).toBe(400)
      expect(await refused.json()).toEqual({ error: 'handle_unusable', problem: 'chars' })
    }
    expect(await testDb().select().from(handles)).toEqual([])
  })

  it('is refused from another site, and to someone signed out', async () => {
    const alice = await signUp('alice')
    expect((await share.pick('alice', { ...alice, origin: 'https://evil.example' })).status).toBe(
      403
    )
    expect((await share.pick('alice', {})).status).toBe(401)
    expect(await (await share.handle(alice)).json()).toMatchObject({ handle: null })
  })
})

describe('Sharing a Recording', () => {
  it('needs a Handle and an uploaded Recording of your own', async () => {
    const alice = await signUp('alice')
    await upload(R1, alice.cookie)
    expect(await (await share.put(R1, alice)).json()).toEqual({ error: 'no_handle' })

    await share.pick('alice', alice)
    expect((await share.put(R2, alice)).status).toBe(404)
    expect((await share.put('not-an-id', alice)).status).toBe(404)
    expect((await share.put(R1, { ...alice, library: 'someone-else' })).status).toBe(409)
    expect((await share.put(R1, {})).status).toBe(401)
  })

  it('makes a link anyone can play, and the same link again', async () => {
    const alice = await sharer('alice')
    expect(alice.url).toMatch(new RegExp(`^${ORIGIN}/@alice/r/[0-9a-hjkmnp-tv-z]{12}/$`))
    // The link names a share of its own, never the Recording's id.
    expect(alice.url).not.toContain(R1)

    const again = await share.put(R1, alice)
    expect(again.status).toBe(200)
    expect(await again.json()).toEqual({ url: alice.url })

    const audio = await share.audio(alice.url)
    expect(audio.status).toBe(200)
    expect(audio.headers.get('content-type')).toBe('audio/wav')
    expect(audio.headers.get('cache-control')).toBe('private, no-cache')
    expect(new Uint8Array(await audio.arrayBuffer())).toEqual(wav())

    const listed = await (await share.list(alice)).json()
    expect(listed).toEqual({
      handle: 'alice',
      shares: [{ kind: 'recordings', itemId: R1, url: alice.url }]
    })
  })

  it('serves the audio from the cache, and answers 304 to a browser that has it', async () => {
    const alice = await sharer('alice')
    const first = await share.audio(alice.url)
    const etag = first.headers.get('etag')
    expect(etag).toBeTruthy()
    await first.arrayBuffer()

    const unchanged = await share.audio(alice.url, { headers: { 'if-none-match': etag ?? '' } })
    expect(unchanged.status).toBe(304)

    // The copy in the cache plays even once R2's is gone, while the share works.
    await media().delete(`users/${alice.id}/recordings/${R1}.wav`)
    const cached = await share.audio(alice.url)
    expect(cached.status).toBe(200)
    expect(new Uint8Array(await cached.arrayBuffer())).toEqual(wav())
  })

  describe('of a trimmed Recording', () => {
    // A take of 1 s at 8 kHz whose every sample is its own frame's number, so a cut says which
    // frames it holds.
    const RATE = 8000
    const take = () => {
      const samples = Float32Array.from({ length: RATE }, (_, i) => i / 0x8000)
      return new Uint8Array(encodeWav({ samples, sampleRate: RATE }))
    }
    const trimmed = (startSeconds: number, endSeconds: number) => ({
      startSeconds,
      endSeconds,
      fart: { startSeconds, endSeconds }
    })

    async function trimmedSharer(trim: ReturnType<typeof trimmed>) {
      const alice = await signUp('alice')
      expect((await share.pick('alice', alice)).status).toBe(201)
      const metadata = recordingMetadata(R1, { seconds: 1, sampleRate: RATE })
      const uploaded = await api.put('recordings', R1, uploadBody(metadata, take()), alice)
      expect(uploaded.status).toBe(201)
      expect((await api.placeAndTrim(R1, { placedPitch: 52, trim }, alice)).status).toBe(200)
      const { url } = (await (await share.put(R1, alice)).json()) as { url: string }
      return { ...alice, url }
    }

    /** The frames a shared WAV holds, once its header is checked: each sample's own number. */
    async function framesOf(response: Response): Promise<number[]> {
      expect(response.status).toBe(200)
      const bytes = new Uint8Array(await response.arrayBuffer())
      const header = readWavHeader(bytes)
      expect(header?.sampleRate).toBe(RATE)
      expect(Number(response.headers.get('content-length'))).toBe(bytes.byteLength)
      const view = new DataView(bytes.buffer, bytes.byteOffset + 44)
      return Array.from({ length: header?.frames ?? 0 }, (_, i) => view.getInt16(i * 2, true))
    }

    const range = (start: number, end: number) =>
      Array.from({ length: end - start }, (_, i) => start + i)

    it('serves only the Trim, never the audio trimmed off', async () => {
      const alice = await trimmedSharer(trimmed(0.25, 0.5))
      // readWavHeader checks the RIFF and data sizes against the bytes: 2,000 frames, and only
      // frames 2,000 to 3,999 of the take.
      expect(await framesOf(await share.audio(alice.url))).toEqual(range(2000, 4000))
    })

    it('serves the new cut once the Trim changes, not the cached one', async () => {
      const alice = await trimmedSharer(trimmed(0.25, 0.5))
      const first = await share.audio(alice.url)
      expect(await framesOf(first)).toEqual(range(2000, 4000))

      expect((await api.placeAndTrim(R1, { trim: trimmed(0.5, 0.625) }, alice)).status).toBe(200)
      const second = await share.audio(alice.url)
      expect(second.headers.get('etag')).not.toBe(first.headers.get('etag'))
      expect(await framesOf(second)).toEqual(range(4000, 5000))

      // Untrimmed, the whole take.
      expect((await api.placeAndTrim(R1, { trim: null }, alice)).status).toBe(200)
      expect(await framesOf(await share.audio(alice.url))).toEqual(range(0, RATE))
    })

    /** `name`, sharing `R1` uploaded with `fields` (its Trim, its analysis) and never placed. */
    async function uploadedSharer(name: string, fields: Record<string, unknown>) {
      const alice = await signUp(name)
      expect((await share.pick(name, alice)).status).toBe(201)
      const metadata = recordingMetadata(R1, { seconds: 1, sampleRate: RATE, ...fields })
      const uploaded = await api.put('recordings', R1, uploadBody(metadata, take()), alice)
      expect(uploaded.status).toBe(201)
      const { url } = (await (await share.put(R1, alice)).json()) as { url: string }
      return { ...alice, url }
    }

    it('serves only a stored Trim, even before analysis or once analysis finds a pitch', async () => {
      // Not yet analyzed: the Recordings tab plays the whole take, but the link serves the Trim.
      const notAnalyzed = await uploadedSharer('alice', {
        analysis: { state: 'notAnalyzed' },
        trim: trimmed(0.25, 0.5)
      })
      expect(await framesOf(await share.audio(notAnalyzed.url))).toEqual(range(2000, 4000))

      // Melodic and not placed, as a Re-scan that finds a pitch leaves a Noise-like one.
      const melodic = await uploadedSharer('bob', { trim: trimmed(0.5, 0.625) })
      const { handle, id } = linkParts(melodic.url)
      const shared = await findSharedRecording(testDb(), handle, id)
      if (!shared) throw new Error('Not shared')
      expect(shared.recording.placedPitch ?? null).toBeNull()
      expect(sharedPart(shared.recording)).toEqual({ startSeconds: 0.5, endSeconds: 0.625 })
      expect(await framesOf(await share.audio(melodic.url))).toEqual(range(4000, 5000))
    })

    it('serves the whole take of a Recording with no stored Trim', async () => {
      const alice = await uploadedSharer('alice', { analysis: { state: 'notAnalyzed' } })
      expect(await framesOf(await share.audio(alice.url))).toEqual(range(0, RATE))
    })

    it('serves a Trim of an odd number of frames as a WAV of its own', async () => {
      // 0.25 s to 0.250375 s at 8 kHz: 3 frames, 6 bytes of data.
      const alice = await trimmedSharer(trimmed(0.25, 0.250375))
      expect(await framesOf(await share.audio(alice.url))).toEqual(range(2000, 2003))
    })

    it('keys the cached copy by the R2 key and the Trim', () => {
      const request = new Request(`${ORIGIN}/@alice/r/x/audio/`)
      const key = (from: number, to: number) =>
        sharedAudioCacheKey(request, 'users/a/recordings/r.wav', {
          startSeconds: from,
          endSeconds: to
        }).url
      expect(key(0.25, 0.5)).not.toBe(key(0.25, 0.625))
      expect(key(0.25, 0.5)).not.toBe(key(0.3, 0.5))
      expect(key(0.25, 0.5)).toBe(key(0.25, 0.5))
    })
  })

  it('shows the page only the Recording, with the link as its id', async () => {
    const alice = await sharer('alice')
    const { handle, id } = linkParts(alice.url)
    const shared = await findSharedRecording(testDb(), handle, id)
    expect(shared).toMatchObject({ handle: 'alice', shareId: id, recording: { id, number: 1 } })
    expect(shared?.recording).not.toHaveProperty('audioBytes')
    // The Handle in the link is matched as lowercase, and must be the owner's.
    expect(await findSharedRecording(testDb(), 'ALICE', id)).not.toBeNull()
    await sharer('bob')
    expect(await findSharedRecording(testDb(), 'bob', id)).toBeNull()
    expect((await share.audio(alice.url.replace('/@alice/', '/@bob/'))).status).toBe(404)
  })

  it("opens only under its owner's @Handle, its @ escaped or not (#382)", async () => {
    const alice = await sharer('alice')
    expect((await share.audio(alice.url.replace('/@alice/', '/%40alice/'))).status).toBe(200)
    for (const first of ['alice', 'u', '@', '%40']) {
      const url = alice.url.replace('/@alice/', `/${first}/`)
      expect((await share.audio(url)).status, url).toBe(404)
      expect((await share.image(url)).status, url).toBe(404)
      expect((await share.report(url)).status, url).toBe(404)
    }
    expect(await testDb().select().from(shareReports)).toEqual([])
  })

  it("can't be shared or stopped by anyone but its owner", async () => {
    const alice = await sharer('alice')
    const bob = await signUp('bob')
    await share.pick('bob', bob)

    expect((await share.put(R1, bob)).status).toBe(404)
    expect((await share.stop(R1, bob)).status).toBe(204)
    expect((await share.audio(alice.url)).status).toBe(200)
    expect(await (await share.list(bob)).json()).toEqual({ handle: 'bob', shares: [] })
  })

  it('stops working when its owner stops sharing it, and a new share is a new link', async () => {
    const alice = await sharer('alice')
    expect((await share.stop(R1, { ...alice, origin: 'https://evil.example' })).status).toBe(403)
    expect((await share.audio(alice.url)).status).toBe(200)

    expect((await share.stop(R1, alice)).status).toBe(204)
    expect((await share.audio(alice.url)).status).toBe(404)
    expect((await share.report(alice.url)).status).toBe(404)
    const { handle, id } = linkParts(alice.url)
    expect(await findSharedRecording(testDb(), handle, id)).toBeNull()
    expect(await (await share.list(alice)).json()).toEqual({ handle: 'alice', shares: [] })

    const again = await share.put(R1, alice)
    expect(again.status).toBe(201)
    const { url } = (await again.json()) as { url: string }
    expect(url).not.toBe(alice.url)
    expect((await share.audio(url)).status).toBe(200)
    expect((await share.audio(alice.url)).status).toBe(404)
  })

  it('stops working when the Recording is deleted', async () => {
    const alice = await sharer('alice')
    expect((await api.delete('recordings', R1, alice)).status).toBe(204)
    expect((await share.audio(alice.url)).status).toBe(404)
    expect(await testDb().select().from(shares)).toEqual([])
    expect((await share.put(R1, alice)).status).toBe(410)
  })

  it('stops working when the account is deleted', async () => {
    const alice = await sharer('alice')
    expect((await api.deleteAccount(alice)).status).toBe(204)
    expect((await share.audio(alice.url)).status).toBe(404)
    expect(await testDb().select().from(shares)).toEqual([])
  })

  it('stays down once Farty takes it down, even if its owner shares it again', async () => {
    const alice = await sharer('alice')
    await testDb().update(shares).set({ takenDownAt: new Date() })
    expect((await share.audio(alice.url)).status).toBe(404)

    const again = await share.put(R1, alice)
    expect(again.status).toBe(403)
    expect(await again.json()).toEqual({ error: 'taken_down' })
    expect((await share.stop(R1, alice)).status).toBe(204)
    expect((await share.put(R1, alice)).status).toBe(403)
    expect(await (await share.list(alice)).json()).toEqual({ handle: 'alice', shares: [] })
  })

  it('never opens a link nobody shared', async () => {
    const alice = await signUp('alice')
    await share.pick('alice', alice)
    await upload(R1, alice.cookie)
    for (const id of ['000000000000', 'abc', R1]) {
      expect((await share.audio(`${ORIGIN}/@alice/r/${id}/`)).status).toBe(404)
    }
  })
})

describe('Reporting a shared Recording', () => {
  it('keeps a row naming the share and the Recording, not the reporter', async () => {
    const alice = await sharer('alice')
    const response = await share.report(alice.url)
    expect(response.status).toBe(204)
    const rows = await testDb().select().from(shareReports)
    expect(rows).toEqual([
      expect.objectContaining({
        shareId: linkParts(alice.url).id,
        userId: alice.id,
        kind: 'recordings',
        itemId: R1
      })
    ])
  })

  it('is refused from another site, or with no origin', async () => {
    const alice = await sharer('alice')
    expect((await share.report(alice.url, 'https://evil.example')).status).toBe(403)
    expect((await share.report(alice.url, null)).status).toBe(403)
    expect(await testDb().select().from(shareReports)).toEqual([])
  })

  it('keeps a few reports a day per Recording, and answers 429 past them', async () => {
    const alice = await sharer('alice')
    for (let i = 0; i < 5; i++) {
      expect((await share.report(alice.url, ORIGIN, `203.0.113.${i}`)).status).toBe(204)
    }
    const refused = await share.report(alice.url, ORIGIN, '203.0.113.9')
    expect(refused.status).toBe(429)
    expect(await refused.json()).toEqual({ error: 'too_many_reports' })
    expect(await testDb().select().from(shareReports)).toHaveLength(5)
    // The refused report spent nothing: not the site's, nor its reporter's.
    expect(await slots('share_report')).toBe(5)
    expect(await slotsLike('share-reporter|%')).toEqual([1, 1, 1, 1, 1])
  })

  it("doesn't start a Recording's reports over when it's shared again under a new link", async () => {
    const alice = await sharer('alice')
    for (let i = 0; i < 5; i++) {
      expect((await share.report(alice.url, ORIGIN, `203.0.113.${i}`)).status).toBe(204)
    }
    // Stop sharing, then Share again: a new link, as a script churning links would make.
    expect((await share.stop(R1, alice)).status).toBe(204)
    const again = (await (await share.put(R1, alice)).json()) as { url: string }
    expect(again.url).not.toBe(alice.url)
    expect((await share.report(again.url, ORIGIN, '198.51.100.1')).status).toBe(429)
    expect(await testDb().select().from(shareReports)).toHaveLength(5)
    expect(await slots('share_report')).toBe(5)
  })

  it('keeps a few reports an hour per reporter, so one client cannot spend the site', async () => {
    const alice = await sharer('alice')
    const bob = await sharer('bob')
    const carol = await sharer('carol')
    for (const link of [alice, bob]) {
      for (let i = 0; i < 5; i++) expect((await share.report(link.url)).status).toBe(204)
    }
    // The same client's 11th report this hour is refused, and spends none of carol's link.
    expect((await share.report(carol.url)).status).toBe(429)
    expect(await slotsLike('share_report_item|usercarol|%')).toEqual([])
    expect(await slots('share_report')).toBe(10)
    // Anyone else's report of it still counts.
    expect((await share.report(carol.url, ORIGIN, '198.51.100.7')).status).toBe(204)
    // Neither the address nor anything else of the reporter is kept.
    const keys = (await testDb().select({ key: rateLimit.key }).from(rateLimit)).map(r => r.key)
    expect(keys.join(' ')).not.toMatch(/203\.0\.113|198\.51\.100/)
  })

  it("answers 429 when the site has had too many, and spends no link's or reporter's slot", async () => {
    const alice = await sharer('alice')
    const now = Date.now()
    await testDb()
      .insert(rateLimit)
      .values({
        id: crypto.randomUUID(),
        key: 'share_report',
        count: 300,
        lastRequest: now + 60 * 60 * 1000
      })
    expect((await share.report(alice.url)).status).toBe(429)
    expect(await testDb().select().from(shareReports)).toEqual([])
    expect(await slotsLike('share_report_item|%')).toEqual([])
    expect(await slotsLike('share-reporter|%')).toEqual([])

    // Once the site's hour is over, the link's reports are all still there to keep.
    await testDb()
      .update(rateLimit)
      .set({ lastRequest: now - 1 })
    for (let i = 0; i < 5; i++) {
      expect((await share.report(alice.url, ORIGIN, `203.0.113.${i}`)).status).toBe(204)
    }
    expect(await testDb().select().from(shareReports)).toHaveLength(5)
  })

  it('puts every report with no client address in one shared bucket, still capped', async () => {
    const alice = await sharer('alice')
    const bob = await sharer('bob')
    const carol = await sharer('carol')
    for (const link of [alice, bob]) {
      for (let i = 0; i < 5; i++) {
        expect((await share.report(link.url, ORIGIN, null)).status).toBe(204)
      }
    }
    expect((await share.report(carol.url, ORIGIN, null)).status).toBe(429)
    expect(await testDb().select().from(shareReports)).toHaveLength(10)
    const reporters = await testDb()
      .select({ key: rateLimit.key, count: rateLimit.count })
      .from(rateLimit)
      .where(like(rateLimit.key, 'share-reporter|%'))
    expect(reporters).toEqual([
      { key: expect.stringMatching(/^share-reporter\|[0-9a-f]+$/), count: 10 }
    ])
    // A reporter with an address is a bucket of its own.
    expect((await share.report(carol.url)).status).toBe(204)
  })

  it('goes with the account', async () => {
    const alice = await sharer('alice')
    await share.report(alice.url)
    await api.deleteAccount(alice)
    expect(await testDb().select().from(shareReports)).toEqual([])
  })
})

describe('Sharing a saved Toot', () => {
  it('needs a Handle and a saved Toot of your own', async () => {
    const alice = await signUp('alice')
    await saveToot(T1, alice)
    expect(await (await share.put(T1, alice, 'toots')).json()).toEqual({ error: 'no_handle' })

    await share.pick('alice', alice)
    // Never saved: one Song Creator only previewed, or one paid for and not saved yet.
    expect((await share.put(T2, alice, 'toots')).status).toBe(404)
    await payFor(alice, T2)
    expect((await share.put(T2, alice, 'toots')).status).toBe(404)
    // A Recording isn't a Toot.
    await upload(R1, alice.cookie)
    expect((await share.put(R1, alice, 'toots')).status).toBe(404)
    expect((await share.put('not-an-id', alice, 'toots')).status).toBe(404)
    expect((await share.put(T1, { ...alice, library: 'someone-else' }, 'toots')).status).toBe(409)
    const elsewhere = { ...alice, origin: 'https://evil.example' }
    expect((await share.put(T1, elsewhere, 'toots')).status).toBe(403)
    expect((await share.put(T1, {}, 'toots')).status).toBe(401)
    expect(await testDb().select().from(shares)).toEqual([])
  })

  it('makes a link anyone can play: the saved WAV, whole and as stored', async () => {
    const alice = await tootSharer('alice')
    expect(alice.url).toMatch(new RegExp(`^${ORIGIN}/@alice/t/[0-9a-hjkmnp-tv-z]{12}/$`))
    // The link names a share of its own, never the Toot's id.
    expect(alice.url).not.toContain(T1)

    const again = await share.put(T1, alice, 'toots')
    expect(again.status).toBe(200)
    expect(await again.json()).toEqual({ url: alice.url })

    const audio = await share.audio(alice.url)
    expect(audio.status).toBe(200)
    expect(audio.headers.get('content-type')).toBe('audio/wav')
    expect(audio.headers.get('cache-control')).toBe('private, no-cache')
    expect(audio.headers.get('content-length')).toBe(String(tootWav().byteLength))
    expect(new Uint8Array(await audio.arrayBuffer())).toEqual(tootWav())

    expect(await (await share.list(alice)).json()).toEqual({
      handle: 'alice',
      shares: [{ kind: 'toots', itemId: T1, url: alice.url }]
    })
  })

  it('serves the audio from the cache, and answers 304 to a browser that has it', async () => {
    const alice = await tootSharer('alice')
    const first = await share.audio(alice.url)
    const etag = first.headers.get('etag')
    expect(etag).toBeTruthy()
    await first.arrayBuffer()

    const unchanged = await share.audio(alice.url, { headers: { 'if-none-match': etag ?? '' } })
    expect(unchanged.status).toBe(304)
    expect(unchanged.headers.get('cache-control')).toBe('private, no-cache')

    // The copy in the cache plays even once R2's is gone, while the share works.
    await media().delete(`users/${alice.id}/toots/${T1}.wav`)
    const cached = await share.audio(alice.url)
    expect(cached.status).toBe(200)
    expect(new Uint8Array(await cached.arrayBuffer())).toEqual(tootWav())
  })

  it('lists Recordings and Toots, each opening only under its own kind of link', async () => {
    const alice = await tootSharer('alice')
    await upload(R1, alice.cookie)
    const recording = (await (await share.put(R1, alice)).json()) as { url: string }
    expect(recording.url).toMatch(new RegExp(`^${ORIGIN}/@alice/r/`))

    const { shares: listed } = (await (await share.list(alice)).json()) as { shares: unknown[] }
    expect(listed).toHaveLength(2)
    expect(listed).toEqual(
      expect.arrayContaining([
        { kind: 'toots', itemId: T1, url: alice.url },
        { kind: 'recordings', itemId: R1, url: recording.url }
      ])
    )

    // A Toot's link never opens as a Recording's, nor a Recording's as a Toot's.
    const asRecording = alice.url.replace('/t/', '/r/')
    const asToot = recording.url.replace('/r/', '/t/')
    expect((await share.audio(asRecording)).status).toBe(404)
    expect((await share.audio(asToot)).status).toBe(404)
    expect((await share.report(asRecording)).status).toBe(404)
    expect((await share.report(asToot)).status).toBe(404)
    expect(await findSharedRecording(testDb(), 'alice', linkParts(alice.url).id)).toBeNull()
    expect(await findSharedToot(testDb(), 'alice', linkParts(recording.url).id)).toBeNull()
  })

  it("shows the page only the Toot's title, Song and length, under its owner's Handle", async () => {
    const alice = await tootSharer('alice')
    const { handle, id } = linkParts(alice.url)
    const shared = await findSharedToot(testDb(), handle, id)
    if (!shared) throw new Error('Not shared')
    // `row` is for the server's own lookups (the WAV's R2 key); the page gets only the rest.
    const { row: _, ...shown } = shared
    expect(shown).toEqual({
      handle: 'alice',
      shareId: id,
      title: 'Twinkle Twinkle Little Star',
      songId: 'twinkle',
      seconds: 0.1
    })
    const page = JSON.stringify(shown)
    for (const secret of [T1, alice.id, 'alice@example.test', tootRecording]) {
      expect(page).not.toContain(secret)
    }
    // The Handle in the link is matched as lowercase, and must be the owner's.
    expect(await findSharedToot(testDb(), 'ALICE', id)).not.toBeNull()
    await tootSharer('bob')
    expect(await findSharedToot(testDb(), 'bob', id)).toBeNull()
    expect((await share.audio(alice.url.replace('/@alice/', '/@bob/'))).status).toBe(404)
  })

  it("opens only under its owner's @Handle (#382)", async () => {
    const alice = await tootSharer('alice')
    expect((await share.audio(alice.url.replace('/@alice/', '/%40alice/'))).status).toBe(200)
    for (const first of ['alice', 'u', '@']) {
      const url = alice.url.replace('/@alice/', `/${first}/`)
      expect((await share.audio(url)).status, url).toBe(404)
      expect((await share.image(url)).status, url).toBe(404)
      expect((await share.report(url)).status, url).toBe(404)
    }
    expect(await testDb().select().from(shareReports)).toEqual([])
  })

  it('shares a Sound Pad Toot too', async () => {
    const alice = await signUp('alice')
    await share.pick('alice', alice)
    await saveToot(T2, alice, tootWav(), padTootMetadata(T2))
    const response = await share.put(T2, alice, 'toots')
    expect(response.status).toBe(201)
    const { url } = (await response.json()) as { url: string }
    const { handle, id } = linkParts(url)
    expect(await findSharedToot(testDb(), handle, id)).toMatchObject({
      title: 'Sound Pad',
      songId: null
    })
    expect((await share.audio(url)).status).toBe(200)
  })

  it("can't be shared or stopped by anyone but its owner", async () => {
    const alice = await tootSharer('alice')
    const bob = await signUp('bob')
    await share.pick('bob', bob)

    expect((await share.put(T1, bob, 'toots')).status).toBe(404)
    expect((await share.stop(T1, bob, 'toots')).status).toBe(204)
    expect((await share.audio(alice.url)).status).toBe(200)
    expect(await (await share.list(bob)).json()).toEqual({ handle: 'bob', shares: [] })
    expect(await testDb().select().from(shares)).toHaveLength(1)
  })

  it('stops working when its owner stops sharing it, and a new share is a new link', async () => {
    const alice = await tootSharer('alice')
    const elsewhere = { ...alice, origin: 'https://evil.example' }
    expect((await share.stop(T1, elsewhere, 'toots')).status).toBe(403)
    expect((await share.audio(alice.url)).status).toBe(200)

    expect((await share.stop(T1, alice, 'toots')).status).toBe(204)
    expect((await share.audio(alice.url)).status).toBe(404)
    expect((await share.report(alice.url)).status).toBe(404)
    const { handle, id } = linkParts(alice.url)
    expect(await findSharedToot(testDb(), handle, id)).toBeNull()
    expect(await (await share.list(alice)).json()).toEqual({ handle: 'alice', shares: [] })

    const again = await share.put(T1, alice, 'toots')
    expect(again.status).toBe(201)
    const { url } = (await again.json()) as { url: string }
    expect(url).not.toBe(alice.url)
    expect((await share.audio(url)).status).toBe(200)
    expect((await share.audio(alice.url)).status).toBe(404)
  })

  it('stops working when the Toot is deleted', async () => {
    const alice = await tootSharer('alice')
    expect((await api.delete('toots', T1, alice)).status).toBe(204)
    expect((await share.audio(alice.url)).status).toBe(404)
    expect((await share.report(alice.url)).status).toBe(404)
    expect(await testDb().select().from(shares)).toEqual([])
    expect((await share.put(T1, alice, 'toots')).status).toBe(410)
  })

  it('stops working when the account is deleted', async () => {
    const alice = await tootSharer('alice')
    expect((await api.deleteAccount(alice)).status).toBe(204)
    expect((await share.audio(alice.url)).status).toBe(404)
    expect(await testDb().select().from(shares)).toEqual([])
  })

  it('stays down once Farty takes it down, even if its owner shares it again', async () => {
    const alice = await tootSharer('alice')
    await testDb().update(shares).set({ takenDownAt: new Date() })
    expect((await share.audio(alice.url)).status).toBe(404)
    expect((await share.report(alice.url)).status).toBe(404)

    const again = await share.put(T1, alice, 'toots')
    expect(again.status).toBe(403)
    expect(await again.json()).toEqual({ error: 'taken_down' })
    expect((await share.stop(T1, alice, 'toots')).status).toBe(204)
    expect((await share.put(T1, alice, 'toots')).status).toBe(403)
    expect(await (await share.list(alice)).json()).toEqual({ handle: 'alice', shares: [] })
  })

  it('stays down while a Recording it plays is taken down, and never shares again', async () => {
    const alice = await signUp('alice')
    await share.pick('alice', alice)
    await upload(R1, alice.cookie)
    expect((await share.put(R1, alice)).status).toBe(201)
    // T1 plays R1 for one of its Song's pitches; T2 tapped R1 on the Sound Pad.
    const arrangement = { transposition: 0, recordingForPitch: { 60: R2, 64: R1 } }
    await saveToot(T1, alice, tootWav(), tootMetadata(T1, { arrangement }))
    await saveToot(T2, alice, tootWav(), padTootMetadata(T2, { performance: playing(R1) }))
    const response = await share.put(T1, alice, 'toots')
    expect(response.status).toBe(201)
    const { url } = (await response.json()) as { url: string }
    expect((await share.audio(url)).status).toBe(200)

    // Farty takes down R1's own link after a report.
    await testDb().update(shares).set({ takenDownAt: new Date() }).where(eq(shares.itemId, R1))

    expect((await share.audio(url)).status).toBe(404)
    expect((await share.report(url)).status).toBe(404)
    const { handle, id } = linkParts(url)
    expect(await findSharedToot(testDb(), handle, id)).toBeNull()
    expect(await (await share.list(alice)).json()).toEqual({ handle: 'alice', shares: [] })
    for (const toot of [T1, T2]) {
      const again = await share.put(toot, alice, 'toots')
      expect(again.status).toBe(403)
      expect(await again.json()).toEqual({ error: 'taken_down' })
    }
    // Deleting R1 keeps its take-down, so the Toots stay down.
    expect((await api.delete('recordings', R1, alice)).status).toBe(204)
    expect((await share.audio(url)).status).toBe(404)
    expect((await share.put(T2, alice, 'toots')).status).toBe(403)
  })

  it('shares a Toot whose Recordings are up, though another Recording is down', async () => {
    const alice = await signUp('alice')
    await share.pick('alice', alice)
    await upload(R1, alice.cookie)
    expect((await share.put(R1, alice)).status).toBe(201)
    await testDb().update(shares).set({ takenDownAt: new Date() }).where(eq(shares.itemId, R1))
    await saveToot(T2, alice, tootWav(), padTootMetadata(T2, { performance: playing(R2) }))
    const response = await share.put(T2, alice, 'toots')
    expect(response.status).toBe(201)
    const { url } = (await response.json()) as { url: string }
    expect((await share.audio(url)).status).toBe(200)
    expect(await (await share.list(alice)).json()).toEqual({
      handle: 'alice',
      shares: [{ kind: 'toots', itemId: T2, url }]
    })
  })

  it('never opens a link nobody shared', async () => {
    const alice = await signUp('alice')
    await share.pick('alice', alice)
    await saveToot(T1, alice)
    for (const id of ['000000000000', 'abc', T1]) {
      expect((await share.audio(`${ORIGIN}/@alice/t/${id}/`)).status).toBe(404)
    }
  })

  it('draws its bars from the saved WAV, kept in the cache by its R2 key', async () => {
    const dora = await signUp('dora')
    await share.pick('dora', dora)
    // 0.75 s at 8 kHz: loud for its first half, then silent, so 30 bars of each.
    const samples = Float32Array.from({ length: 6000 }, (_, i) => (i < 3000 ? 0.5 : 0))
    await saveToot(T2, dora, new Uint8Array(encodeWav({ samples, sampleRate: 8000 })))
    const { url } = (await (await share.put(T2, dora, 'toots')).json()) as { url: string }
    const { handle, id } = linkParts(url)
    const shared = await findSharedToot(testDb(), handle, id)
    if (!shared) throw new Error('Not shared')

    const key = sharedTootKey(shared)
    expect(key).toBe(`users/${dora.id}/toots/${T2}.wav`)
    const levels = await sharedTootLevels(media(), key, ORIGIN)
    expect(levels).toHaveLength(SHARED_TOOT_BARS)
    expect(levels).toEqual([...Array(30).fill(1), ...Array(30).fill(0.05)])

    await media().delete(key)
    expect(await sharedTootLevels(media(), key, ORIGIN)).toEqual(levels)
    // Flat for audio that's gone and was never drawn.
    const gone = await sharedTootLevels(media(), `users/${dora.id}/toots/${T1}.wav`, ORIGIN)
    expect(gone).toEqual(Array(SHARED_TOOT_BARS).fill(0.05))
  })
})

describe('Reporting a shared Toot', () => {
  it('keeps a row naming the share and the Toot, not the reporter', async () => {
    const alice = await tootSharer('alice')
    expect((await share.report(alice.url)).status).toBe(204)
    expect(await testDb().select().from(shareReports)).toEqual([
      expect.objectContaining({
        shareId: linkParts(alice.url).id,
        userId: alice.id,
        kind: 'toots',
        itemId: T1
      })
    ])
    expect(await slots(`share_report_item|${alice.id}|toots|${T1}`)).toBe(1)
  })

  it('is refused from another site, or with no origin', async () => {
    const alice = await tootSharer('alice')
    expect((await share.report(alice.url, 'https://evil.example')).status).toBe(403)
    expect((await share.report(alice.url, null)).status).toBe(403)
    expect(await testDb().select().from(shareReports)).toEqual([])
  })

  it("keeps a few reports a day per Toot, and doesn't start over under a new link", async () => {
    const alice = await tootSharer('alice')
    for (let i = 0; i < 5; i++) {
      expect((await share.report(alice.url, ORIGIN, `203.0.113.${i}`)).status).toBe(204)
    }
    expect((await share.report(alice.url, ORIGIN, '203.0.113.9')).status).toBe(429)

    expect((await share.stop(T1, alice, 'toots')).status).toBe(204)
    const again = (await (await share.put(T1, alice, 'toots')).json()) as { url: string }
    expect(again.url).not.toBe(alice.url)
    expect((await share.report(again.url, ORIGIN, '198.51.100.1')).status).toBe(429)
    expect(await testDb().select().from(shareReports)).toHaveLength(5)
    expect(await slots('share_report')).toBe(5)
  })

  it("spends the same reporter's and site's slots as a Recording's report", async () => {
    const alice = await sharer('alice')
    await saveToot(T1, alice)
    const toot = (await (await share.put(T1, alice, 'toots')).json()) as { url: string }
    const bob = await tootSharer('bob')
    for (const url of [alice.url, toot.url]) {
      for (let i = 0; i < 5; i++) expect((await share.report(url)).status).toBe(204)
    }
    // The same client's 11th report this hour is refused, a Toot's as a Recording's.
    expect((await share.report(bob.url)).status).toBe(429)
    expect(await slots('share_report')).toBe(10)
    expect(await slotsLike('share-reporter|%')).toEqual([10])
    expect((await share.report(bob.url, ORIGIN, '198.51.100.7')).status).toBe(204)
  })
})

describe('The frames a shared Trim covers', () => {
  // A take of 1 s at 8 kHz: 8,000 frames.
  const frames = (startSeconds: number, endSeconds: number, sampleRate = 8000, total = 8000) =>
    partFrames({ startSeconds, endSeconds }, sampleRate, total)

  it('starts at the first frame for a Trim at 0', () => {
    expect(frames(0, 0.25)).toEqual({ start: 0, end: 2000 })
    expect(frames(0, 1)).toEqual({ start: 0, end: 8000 })
  })

  it('ends at the last frame for a Trim at the end, or past it by the tolerance', () => {
    expect(frames(0.75, 1)).toEqual({ start: 6000, end: 8000 })
    expect(frames(0.995, 1.01)).toEqual({ start: 7960, end: 8000 })
    expect(frames(1.005, 1.01)).toEqual({ start: 7999, end: 8000 })
  })

  it('rounds each end to its nearest frame, at an odd rate or an odd number of frames', () => {
    // 0.5 s at 11,025 Hz is frame 5,512.5: rounded up.
    expect(frames(0, 0.5, 11025, 11025)).toEqual({ start: 0, end: 5513 })
    expect(frames(0.5, 1, 8000, 8001)).toEqual({ start: 4000, end: 8000 })
    expect(frames(0.5, 2, 8000, 8001)).toEqual({ start: 4000, end: 8001 })
    expect(frames(0.25, 0.250375)).toEqual({ start: 2000, end: 2003 })
  })

  it('covers one frame for an empty or inverted Trim', () => {
    expect(frames(0.5, 0.5)).toEqual({ start: 4000, end: 4001 })
    expect(frames(0.5, 0.25)).toEqual({ start: 4000, end: 4001 })
    expect(frames(1, 1)).toEqual({ start: 7999, end: 8000 })
  })
})
