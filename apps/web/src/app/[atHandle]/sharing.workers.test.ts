import { and, eq, like } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import * as handleRoute from '@/app/api/handle/route'
import * as shareRecordingRoute from '@/app/api/share/recordings/[id]/route'
import * as sharesRoute from '@/app/api/share/route'
import * as shareTootRoute from '@/app/api/share/toots/[id]/route'
import type { Kind } from '@/db/library'
import { handles, rateLimit, recordings, shareReports, shares, toots, user } from '@/db/schema'
import { NOT_SAID } from '@/lib/fart-place'
import { noteName } from '@/lib/pitch'
import { encodeWav } from '@/lib/wav'
import { findProfile } from '@/server/profiles'
import {
  findSharedRecording,
  findSharedToot,
  partFrames,
  SHARED_TOOT_BARS,
  sharedAudioCacheKey,
  sharedPart,
  sharedTootKey,
  sharedTootLevels,
  sharedTootParts
} from '@/server/sharing'
import { readWavHeader } from '@/server/wav-header'
import {
  type As,
  api,
  giveFullAccess,
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
import { requestCf } from '@/test-support/workers-cf'

import * as audioRoute from './r/[id]/audio/route'
import * as imageRoute from './r/[id]/image/route'
import * as reportRoute from './r/[id]/report/route'
import { sharedView } from './r/[id]/shared'
import * as tootAudioRoute from './t/[id]/audio/route'
import * as tootFartAudioRoute from './t/[id]/farts/[place]/audio/route'
import * as tootImageRoute from './t/[id]/image/route'
import * as tootReportRoute from './t/[id]/report/route'
import * as tootRowRoute from './t/[id]/row/route'

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
  t: { audio: tootAudioRoute, image: tootImageRoute, report: tootReportRoute, row: tootRowRoute }
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
  /** One of a shared Toot's farts, by its place, as anyone with the link fetches it. */
  fart: (url: string, place: string | number, init: RequestInit = {}) => {
    const { atHandle, id } = linkParts(url)
    return tootFartAudioRoute.GET(
      new Request(`${url}farts/${place}/audio/`, { ...init, method: 'GET' }),
      params({ atHandle, id, place: String(place) })
    )
  },
  /** A shared Toot's `row/`, as its profile page row fetches it. Only a Toot's link has one. */
  row: (url: string) => {
    const { segment, atHandle, id } = linkParts(url)
    if (segment !== 't') throw new Error(`Only a Toot's link has a row/: ${url}`)
    return linkRoutes.t.row.GET(new Request(`${url}row/`), params({ atHandle, id }))
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

/** That a shared Toot's `row/` is gone: a bare 404 that says nothing of the Toot or its farts. */
async function expectRowGone(url: string) {
  const response = await share.row(url)
  expect(response.status).toBe(404)
  expect(response.headers.get('content-type')).toContain('application/json')
  expect(await response.text()).toBe(JSON.stringify({ error: 'not_found' }))
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

/** Saves the Toot `id` to an account with Full Access, as Song Creator's Save does. */
async function saveToot(
  id: string,
  user: { id: string; cookie: string },
  audio = tootWav(),
  metadata: { songId: string | null } = tootMetadata(id)
) {
  await giveFullAccess(user.id)
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
    expect(alice.url).toBe(`${ORIGIN}/@alice/r/recording-1/`)
    // The link is named for the Recording, never its id.
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

    /** Its row on `handle`'s profile page, and what its own page at `url` shows. */
    async function rowAndPage(handle: string, url: string) {
      const { id } = linkParts(url)
      const [row] = (await findProfile(testDb(), handle))?.items ?? []
      const page = await sharedView(handle, id)
      return { row, page }
    }

    it("lists it on its profile page at its own page's length, its fart's, and plays and draws only the fart (#448)", async () => {
      // A second of take whose fart comes after 0.3 s of lead-in silence: 0.575 s, so "0.5 s".
      const { analysis } = recordingMetadata(R1) as { analysis: { analysis: object } }
      const alice = await uploadedSharer('alice', {
        waveform: [0, 0, 0, 0.5, 1, 0.5, 0.2, 0],
        analysis: {
          state: 'analyzed',
          analysis: { ...analysis.analysis, gestureStartSeconds: 0.3, gestureEndSeconds: 0.875 }
        }
      })
      // Its link still serves the whole take; the row plays only the fart in it.
      expect(await framesOf(await share.audio(alice.url))).toEqual(range(0, RATE))
      const untrimmed = await rowAndPage('alice', alice.url)
      expect(untrimmed.page?.length).toBe('0.5 s')
      expect(untrimmed.row).toMatchObject({
        length: untrimmed.page?.length,
        part: { startSeconds: 0.3, endSeconds: 0.875 },
        levels: [0, 0.5, 1, 0.5, 0.2]
      })
    })

    it("times a trimmed one's fart from where its link's audio starts (#448)", async () => {
      // Its link serves 0.25 s to 0.75 s; the fart between the handles is 0.375 s to 0.625 s.
      const alice = await trimmedSharer({
        startSeconds: 0.25,
        endSeconds: 0.75,
        fart: { startSeconds: 0.375, endSeconds: 0.625 }
      })
      expect(await framesOf(await share.audio(alice.url))).toEqual(range(2000, 6000))
      const { row, page } = await rowAndPage('alice', alice.url)
      expect(page?.length).toBe('0.2 s')
      expect(row).toMatchObject({
        length: page?.length,
        part: { startSeconds: 0.125, endSeconds: 0.375 }
      })
    })

    it("prints the length of what its row plays when its Trim's fart lies outside the handles (#450)", async () => {
      // Stored before the API checked a Trim's fart: handles 0.25 s to 0.75 s.
      const alice = await trimmedSharer({
        startSeconds: 0.25,
        endSeconds: 0.75,
        fart: { startSeconds: 0.375, endSeconds: 0.625 }
      })
      const moveFart = (startSeconds: number, endSeconds: number) =>
        testDb()
          .update(recordings)
          .set({ trimFartStartSeconds: startSeconds, trimFartEndSeconds: endSeconds })
          .where(eq(recordings.id, R1))

      // Half out: 0.5 s to 0.95 s is a 0.45 s fart, but the link serves only 0.5 s to 0.75 s of it.
      await moveFart(0.5, 0.95)
      const halfOut = await rowAndPage('alice', alice.url)
      expect(halfOut.page?.length).toBe('0.2 s')
      expect(halfOut.row).toMatchObject({
        length: halfOut.page?.length,
        part: { startSeconds: 0.25, endSeconds: 0.5 }
      })

      // All out: 0.8 s to 0.95 s is past the end handle, so the row plays all the link serves.
      await moveFart(0.8, 0.95)
      const allOut = await rowAndPage('alice', alice.url)
      expect(allOut.page?.length).toBe('0.5 s')
      expect(allOut.row).toMatchObject({
        length: allOut.page?.length,
        part: { startSeconds: 0, endSeconds: 0.5 }
      })
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
    expect(shared).toMatchObject({ handle: 'alice', slug: id, recording: { id, number: 1 } })
    expect(shared?.recording).not.toHaveProperty('audioBytes')
    // The Handle in the link is matched as lowercase, and must be the owner's.
    expect(await findSharedRecording(testDb(), 'ALICE', id)).not.toBeNull()
    const [{ id: alicesShare }] = await testDb().select().from(shares)
    await sharer('bob')
    expect(await findSharedRecording(testDb(), 'bob', alicesShare)).toBeNull()
    expect((await share.audio(`${ORIGIN}/@bob/r/${alicesShare}/`)).status).toBe(404)
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

  it('stops working when its owner stops sharing it, and sharing again brings it back', async () => {
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
    expect(url).toBe(alice.url)
    expect((await share.audio(url)).status).toBe(200)
  })

  it('stops working when the Recording is deleted', async () => {
    const alice = await sharer('alice')
    expect((await api.delete('recordings', R1, alice)).status).toBe(204)
    expect((await share.audio(alice.url)).status).toBe(404)
    expect(await testDb().select().from(shares)).toEqual([])
    expect((await share.put(R1, alice)).status).toBe(410)
  })

  it('stops working when the account is deleted, and so do the rows of Toots playing it', async () => {
    const alice = await sharer('alice')
    // A Toot playing R1, shared too: its profile row's `row/` works until the account goes.
    await saveToot(
      T1,
      alice,
      tootWav(),
      tootMetadata(T1, {
        arrangement: { transposition: 0, recordingForPitch: { 60: R1 } }
      })
    )
    const toot = (await (await share.put(T1, alice, 'toots')).json()) as { url: string }
    expect((await share.row(toot.url)).status).toBe(200)

    expect((await api.deleteAccount(alice)).status).toBe(204)
    expect((await share.audio(alice.url)).status).toBe(404)
    await expectRowGone(toot.url)
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
        shareId: (await testDb().select().from(shares))[0].id,
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

  it("doesn't start a Recording's reports over when it's shared again", async () => {
    const alice = await sharer('alice')
    for (let i = 0; i < 5; i++) {
      expect((await share.report(alice.url, ORIGIN, `203.0.113.${i}`)).status).toBe(204)
    }
    // Stop sharing, then Share again: a new share, as a script churning them would make.
    expect((await share.stop(R1, alice)).status).toBe(204)
    const again = (await (await share.put(R1, alice)).json()) as { url: string }
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
    // Never saved: one Song Creator only previewed.
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
    expect(alice.url).toBe(`${ORIGIN}/@alice/t/twinkle-twinkle-little-star/`)
    // The link is named for the Song, never the Toot's id.
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
      slug: id,
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
    const [{ id: alicesShare }] = await testDb().select().from(shares)
    await tootSharer('bob')
    expect(await findSharedToot(testDb(), 'bob', alicesShare)).toBeNull()
    expect((await share.audio(`${ORIGIN}/@bob/t/${alicesShare}/`)).status).toBe(404)
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

  it('stops working when its owner stops sharing it, and sharing again brings it back', async () => {
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
    expect(url).toBe(alice.url)
    expect((await share.audio(url)).status).toBe(200)
  })

  it('stops working when the Toot is deleted', async () => {
    const alice = await tootSharer('alice')
    expect((await share.row(alice.url)).status).toBe(200)
    expect((await api.delete('toots', T1, alice)).status).toBe(204)
    expect((await share.audio(alice.url)).status).toBe(404)
    expect((await share.report(alice.url)).status).toBe(404)
    await expectRowGone(alice.url)
    expect(await testDb().select().from(shares)).toEqual([])
    expect((await share.put(T1, alice, 'toots')).status).toBe(410)
  })

  it('stops working when the account is deleted', async () => {
    const alice = await tootSharer('alice')
    expect((await share.row(alice.url)).status).toBe(200)
    expect((await api.deleteAccount(alice)).status).toBe(204)
    expect((await share.audio(alice.url)).status).toBe(404)
    await expectRowGone(alice.url)
    expect(await testDb().select().from(shares)).toEqual([])
  })

  it('stays down once Farty takes it down, even if its owner shares it again', async () => {
    const alice = await tootSharer('alice')
    await testDb().update(shares).set({ takenDownAt: new Date() })
    expect((await share.audio(alice.url)).status).toBe(404)
    expect((await share.report(alice.url)).status).toBe(404)
    await expectRowGone(alice.url)

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
    expect((await share.row(url)).status).toBe(200)

    // Farty takes down R1's own link after a report.
    await testDb().update(shares).set({ takenDownAt: new Date() }).where(eq(shares.itemId, R1))

    expect((await share.audio(url)).status).toBe(404)
    expect((await share.report(url)).status).toBe(404)
    await expectRowGone(url)
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
    await expectRowGone(url)
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

  it('serves its bars and roll at `row/` for its profile page row, only while its link works (#448)', async () => {
    const dora = await signUp('dora')
    await share.pick('dora', dora)
    const samples = Float32Array.from({ length: 6000 }, (_, i) => (i < 3000 ? 0.5 : 0))
    await saveToot(T2, dora, new Uint8Array(encodeWav({ samples, sampleRate: 8000 })))
    const { url } = (await (await share.put(T2, dora, 'toots')).json()) as { url: string }
    const { id } = linkParts(url)

    const served = await share.row(url)
    expect(served.status).toBe(200)
    expect(served.headers.get('cache-control')).toBe('private, no-cache')
    // Its roll as its own page draws it: saved before #254, so its Song's notes, which the page
    // fetches, and the one pitch a fart plays. Nothing of its farts, so never where one was made.
    expect(await served.json()).toEqual({
      levels: [...Array(30).fill(1), ...Array(30).fill(0.05)],
      roll: {
        song: null,
        catalogSong: expect.objectContaining({ id: 'twinkle' }),
        played: [60]
      }
    })

    expect((await share.stop(T2, dora, 'toots')).status).toBe(204)
    await expectRowGone(url)
    // And never for another Handle's link.
    await expectRowGone(`${ORIGIN}/@alice/t/${id}/`)
  })
})

describe('Reporting a shared Toot', () => {
  it('keeps a row naming the share and the Toot, not the reporter', async () => {
    const alice = await tootSharer('alice')
    expect((await share.report(alice.url)).status).toBe(204)
    expect(await testDb().select().from(shareReports)).toEqual([
      expect.objectContaining({
        shareId: (await testDb().select().from(shares))[0].id,
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

  it("keeps a few reports a day per Toot, and doesn't start over when it's shared again", async () => {
    const alice = await tootSharer('alice')
    for (let i = 0; i < 5; i++) {
      expect((await share.report(alice.url, ORIGIN, `203.0.113.${i}`)).status).toBe(204)
    }
    expect((await share.report(alice.url, ORIGIN, '203.0.113.9')).status).toBe(429)

    expect((await share.stop(T1, alice, 'toots')).status).toBe(204)
    const again = (await (await share.put(T1, alice, 'toots')).json()) as { url: string }
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

describe('Where a shared fart was made (#444)', () => {
  const AUSTIN = {
    city: 'Austin',
    region: 'Texas',
    regionCode: 'TX',
    country: 'US',
    timezone: 'America/Chicago',
    latitude: '30.27130',
    longitude: '-97.74260',
    postalCode: '78701',
    metroCode: '635'
  }
  const PARIS = { city: 'Paris', country: 'FR', timezone: 'Europe/Paris' }
  const KEPT = { city: 'Austin', region: 'Texas', country: 'US', timeZone: 'America/Chicago' }
  const SAID = { recordedIn: 'Austin, Texas', timeZone: 'America/Chicago' }

  const placeKept = async (id: string, userId: string) => {
    const [row] = await testDb()
      .select({ place: recordings.place })
      .from(recordings)
      .where(and(eq(recordings.userId, userId), eq(recordings.id, id)))
    return row.place
  }

  /** Alice, with a Handle and `R1` uploaded from Austin, just recorded unless `fields` says. */
  async function fromAustin(fields: Record<string, unknown> = {}) {
    const alice = await signUp('alice')
    expect((await share.pick('alice', alice)).status).toBe(201)
    requestCf.current = AUSTIN
    const metadata = recordingMetadata(R1, {
      number: 1,
      seconds: 1,
      sampleRate: RATE,
      createdAt: Date.now(),
      ...fields
    })
    const uploaded = await api.put('recordings', R1, uploadBody(metadata, take()), alice)
    expect(uploaded.status).toBe(201)
    return alice
  }

  const urlOf = async (response: Response) => {
    expect(response.status).toBe(201)
    return ((await response.json()) as { url: string }).url
  }

  const viewOf = (url: string) => {
    const { handle, id } = linkParts(url)
    return sharedView(handle, id)
  }

  /** What the page gets for `url`, a shared Toot's link. */
  const partsOf = async (url: string) => {
    const { handle, id } = linkParts(url)
    const shared = await findSharedToot(testDb(), handle, id)
    if (!shared) throw new Error(`No shared Toot at ${url}`)
    return sharedTootParts(testDb(), shared)
  }

  /** Shares `R1`, and a Toot that plays it, as `alice`. */
  async function shareBoth(alice: Awaited<ReturnType<typeof signUp>>) {
    const arrangement = { transposition: 0, recordingForPitch: { 60: R1 } }
    await saveToot(T1, alice, tootWav(), tootMetadata(T1, { arrangement }))
    return {
      recording: await urlOf(await share.put(R1, alice)),
      toot: await urlOf(await share.put(T1, alice, 'toots'))
    }
  }

  it('keeps the city, region, country and time zone of the first upload, and nothing finer', async () => {
    const alice = await fromAustin()
    expect(await placeKept(R1, alice.id)).toEqual(KEPT)
  })

  it('tells a shared Recording and each row of a shared Toot where it was made', async () => {
    const alice = await fromAustin()
    const { recording, toot } = await shareBoth(alice)
    expect(await viewOf(recording)).toMatchObject(SAID)
    const { rows } = await partsOf(toot)
    expect(rows[0].fart).toMatchObject(SAID)
  })

  it('never changes it by uploading again or editing', async () => {
    const alice = await fromAustin()
    requestCf.current = PARIS
    const metadata = recordingMetadata(R1, {
      number: 1,
      seconds: 1,
      sampleRate: RATE,
      createdAt: Date.now()
    })
    expect((await api.put('recordings', R1, uploadBody(metadata, take()), alice)).status).toBe(200)
    expect((await api.placeAndTrim(R1, { name: 'Big one' }, alice)).status).toBe(200)
    expect((await api.place(R1, 60, alice)).status).toBe(200)
    expect((await api.placeAndTrim(R1, { trim: trimmed(0.25, 0.5) }, alice)).status).toBe(200)
    expect(await placeKept(R1, alice.id)).toEqual(KEPT)
  })

  it('keeps none for a take recorded more than an hour before it uploads', async () => {
    const alice = await fromAustin({ createdAt: Date.now() - 61 * 60 * 1000 })
    expect(await placeKept(R1, alice.id)).toBeNull()
    expect(await viewOf(await urlOf(await share.put(R1, alice)))).toMatchObject(NOT_SAID)
  })

  it('keeps one for a take up to an hour old', async () => {
    const alice = await fromAustin({ createdAt: Date.now() - 59 * 60 * 1000 })
    expect(await placeKept(R1, alice.id)).toEqual(KEPT)
  })

  it('keeps none with no Cloudflare properties, whatever the browser says', async () => {
    const alice = await signUp('alice')
    requestCf.current = undefined
    const metadata = recordingMetadata(R1, {
      number: 1,
      seconds: 1,
      sampleRate: RATE,
      createdAt: Date.now(),
      place: KEPT
    })
    expect((await api.put('recordings', R1, uploadBody(metadata, take()), alice)).status).toBe(201)
    expect(await placeKept(R1, alice.id)).toBeNull()
  })

  it('never sends it to the profile page, whose rows and banner say only the day (#448)', async () => {
    const alice = await fromAustin()
    const { recording } = await shareBoth(alice)
    // Its own page says it.
    expect(await viewOf(recording)).toMatchObject(SAID)
    const profile = await findProfile(testDb(), 'alice')
    expect(profile?.items).toHaveLength(2)
    expect(profile?.hero).not.toBeNull()
    const page = JSON.stringify(profile)
    expect(page).not.toContain('Austin')
    expect(page).not.toContain('Texas')
    expect(page).not.toContain('America/Chicago')
  })

  it("never sends it to the owner's library", async () => {
    const alice = await fromAustin()
    const library = await (await api.library(alice)).text()
    expect(library).toContain(R1)
    expect(library).not.toContain('Austin')
    expect(library).not.toContain('America/Chicago')
  })

  it('forgets it as soon as the switch is off, on links already sent too, and on again says it only of new ones', async () => {
    const alice = await fromAustin()
    const { recording, toot } = await shareBoth(alice)

    const off = await api.patchAccount({ showFartPlaces: false }, alice)
    expect(off.status).toBe(200)
    expect(await off.json()).toEqual({ showFartPlaces: false })

    const view = await viewOf(recording)
    expect(view).toMatchObject(NOT_SAID)
    const parts = await partsOf(toot)
    expect(parts.rows[0].fart).toMatchObject(NOT_SAID)
    for (const data of [JSON.stringify(view), JSON.stringify(parts)]) {
      expect(data).not.toContain('Austin')
      expect(data).not.toContain('Texas')
      expect(data).not.toContain('America/Chicago')
    }

    expect(await placeKept(R1, alice.id)).toBeNull()

    expect((await api.patchAccount({ showFartPlaces: true }, alice)).status).toBe(200)
    expect(await viewOf(recording)).toMatchObject(NOT_SAID)
    expect((await partsOf(toot)).rows[0].fart).toMatchObject(NOT_SAID)

    const metadata = recordingMetadata(R2, {
      number: 2,
      seconds: 1,
      sampleRate: RATE,
      createdAt: Date.now()
    })
    expect((await api.put('recordings', R2, uploadBody(metadata, take()), alice)).status).toBe(201)
    expect(await placeKept(R2, alice.id)).toEqual(KEPT)
  })

  it("forgets only that owner's, and only for that switch", async () => {
    const alice = await fromAustin()
    expect((await api.patchAccount({ marketingEmail: false }, alice)).status).toBe(200)
    expect(await placeKept(R1, alice.id)).toEqual(KEPT)

    const bob = await signUp('bob')
    expect((await api.patchAccount({ showFartPlaces: false }, bob)).status).toBe(200)
    expect(await placeKept(R1, alice.id)).toEqual(KEPT)
  })

  it('keeps none for a Recording uploaded with the switch off', async () => {
    const alice = await signUp('alice')
    expect((await api.patchAccount({ showFartPlaces: false }, alice)).status).toBe(200)
    requestCf.current = AUSTIN
    const metadata = recordingMetadata(R1, {
      number: 1,
      seconds: 1,
      sampleRate: RATE,
      createdAt: Date.now()
    })
    expect((await api.put('recordings', R1, uploadBody(metadata, take()), alice)).status).toBe(201)
    expect(await placeKept(R1, alice.id)).toBeNull()
  })

  it('forgets it when the Recording is deleted', async () => {
    const alice = await fromAustin()
    expect((await api.delete('recordings', R1, alice)).status).toBe(204)
    expect(await placeKept(R1, alice.id)).toBeNull()
  })

  it('takes one switch at a time, and changes nothing for a bad one', async () => {
    const alice = await signUp('alice')
    const switches = async () => {
      const [row] = await testDb()
        .select({ news: user.marketingEmail, places: user.showFartPlaces })
        .from(user)
        .where(eq(user.id, alice.id))
      return row
    }
    expect(await switches()).toEqual({ news: true, places: true })
    for (const bad of [
      { showFartPlaces: 'no' },
      { marketingEmail: false, showFartPlaces: false },
      { marketingEmail: 'no', showFartPlaces: false }
    ]) {
      expect((await api.patchAccount(bad, alice)).status).toBe(400)
      expect(await switches()).toEqual({ news: true, places: true })
    }
    expect((await api.patchAccount({ showFartPlaces: false }, alice)).status).toBe(200)
    expect(await switches()).toEqual({ news: true, places: false })
  })
})

describe("What a shared Toot shows of what it's made of (#443)", () => {
  /** The frames of the fart `recordingMetadata` says analysis found, 0.01 s to 0.09 s, at `RATE`. */
  const FOUND_START = 80
  const FOUND_END = 720

  /** What the page gets for the link at `url`. */
  async function partsOf(url: string) {
    const { handle, id } = linkParts(url)
    const shared = await findSharedToot(testDb(), handle, id)
    if (!shared) throw new Error(`No shared Toot at ${url}`)
    return sharedTootParts(testDb(), shared)
  }

  /** A user with a Handle and two takes: `R1` trimmed to 0.25 s, its first, and `R2` whole. */
  async function withFarts(name: string) {
    const user = await signUp(name)
    expect((await share.pick(name, user)).status).toBe(201)
    for (const [id, number] of [
      [R1, 1],
      [R2, 2]
    ] as const) {
      const metadata = recordingMetadata(id, { number, seconds: 1, sampleRate: RATE })
      const uploaded = await api.put('recordings', id, uploadBody(metadata, take()), user)
      expect(uploaded.status).toBe(201)
    }
    const placed = await api.placeAndTrim(R1, { trim: trimmed(0.25, 0.5) }, user)
    expect(placed.status).toBe(200)
    return user
  }

  const urlOf = async (response: Response) => {
    expect(response.status).toBe(201)
    return ((await response.json()) as { url: string }).url
  }

  const arrangement = { transposition: -12, recordingForPitch: { 60: R1, 64: R2 } }

  /** Alice's Toot `T1` of its Song, shared, with R1 playing pitch 60 and R2 pitch 64. */
  async function songToot(fields: Record<string, unknown> = {}) {
    const alice = await withFarts('alice')
    await saveToot(T1, alice, tootWav(), tootMetadata(T1, { arrangement, ...fields }))
    return { ...alice, url: await urlOf(await share.put(T1, alice, 'toots')) }
  }

  it('plays each fart alone, by its place, and only the fart', async () => {
    const { url } = await songToot()
    const first = await share.fart(url, 0)
    expect(first.headers.get('cache-control')).toBe('private, no-cache')
    const etag = first.headers.get('etag')
    // It says nothing of where the fart sits in its take.
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/)
    expect(await framesOf(first)).toEqual(range(2000, 4000))
    expect(await framesOf(await share.fart(url, 1))).toEqual(range(FOUND_START, FOUND_END))

    // Each play asks D1 again, as the link's own audio does.
    const again = await share.fart(url, 0, { headers: { 'if-none-match': etag ?? '' } })
    expect(again.status).toBe(304)
  })

  /** Alice's Toot `T1`, shared, played by `R1`, uploaded with `fields` and never placed. */
  async function tootOfOneFart(fields: Record<string, unknown>) {
    const alice = await signUp('alice')
    expect((await share.pick('alice', alice)).status).toBe(201)
    const metadata = recordingMetadata(R1, { seconds: 1, sampleRate: RATE, ...fields })
    expect((await api.put('recordings', R1, uploadBody(metadata, take()), alice)).status).toBe(201)
    const recordingForPitch = { 60: R1 }
    await saveToot(
      T1,
      alice,
      tootWav(),
      tootMetadata(T1, { arrangement: { transposition: 0, recordingForPitch } })
    )
    return { ...alice, url: await urlOf(await share.put(T1, alice, 'toots')) }
  }

  it('never serves the rest of a long take, only the fart analysis found in it', async () => {
    // A take with talking around its fart: only 0.25 s to 0.5 s of it is the fart.
    const { analysis } = recordingMetadata(R1) as { analysis: { analysis: object } }
    const { url } = await tootOfOneFart({
      waveform: [0.1, 0.2, 0.3, 0.4],
      analysis: {
        state: 'analyzed',
        analysis: { ...analysis.analysis, gestureStartSeconds: 0.25, gestureEndSeconds: 0.5 }
      }
    })
    expect(await framesOf(await share.fart(url, 0))).toEqual(range(2000, 4000))

    const [row] = (await partsOf(url)).rows
    // Its one stored bar drawn as Song Creator draws a fart, in 16 thin bars (#451).
    expect(row.fart).toMatchObject({
      length: '0.2 s',
      levels: Array(16).fill(0.2),
      playable: true
    })
  })

  it("has nothing to play of a fart analysis hasn't found, with no Trim", async () => {
    const { url } = await tootOfOneFart({ analysis: { state: 'notAnalyzed' } })
    expect((await share.fart(url, 0)).status).toBe(404)

    const [row] = (await partsOf(url)).rows
    expect(row.fart).toMatchObject({ name: 'Recording 1', length: '', levels: [], playable: false })
  })

  it("serves a stored Trim's fart without what else its handles hold, even before analysis", async () => {
    const trim = {
      startSeconds: 0.25,
      endSeconds: 0.75,
      fart: { startSeconds: 0.375, endSeconds: 0.5 }
    }
    const alice = await tootOfOneFart({ analysis: { state: 'notAnalyzed' }, trim })
    expect(await framesOf(await share.fart(alice.url, 0))).toEqual(range(3000, 4000))

    // The Recording's own link serves all its owner left between the handles.
    const { url } = (await (await share.put(R1, alice)).json()) as { url: string }
    expect(await framesOf(await share.audio(url))).toEqual(range(2000, 6000))
  })

  it('never serves what its handles cut off, when its fart reaches past them', async () => {
    // A fart may start half a sample before its handle (`parseTrim`).
    const trim = {
      startSeconds: 0.25,
      endSeconds: 0.5,
      fart: { startSeconds: 0.2495, endSeconds: 0.5 }
    }
    const { url } = await tootOfOneFart({ trim })
    expect(await framesOf(await share.fart(url, 0))).toEqual(range(2000, 4000))
  })

  it('answers 404 for a place that names no fart', async () => {
    const { url } = await songToot()
    for (const place of [2, 'x', '-1', '1.5', '0x1', '1000', '']) {
      expect((await share.fart(url, place)).status).toBe(404)
    }
  })

  it('tells the page each fart with no Recording or Toot id', async () => {
    const { url } = await songToot()
    const parts = await partsOf(url)
    expect(parts.lanes).toBe(false)
    expect(parts.transposition).toBe(-12)
    expect(
      parts.rows.map(({ pitch, plays, colorIndex }) => ({ pitch, plays, colorIndex }))
    ).toEqual([
      { pitch: 60, plays: noteName(48), colorIndex: expect.any(Number) },
      { pitch: 64, plays: noteName(52), colorIndex: expect.any(Number) }
    ])
    expect(parts.rows.map(row => row.fart?.place)).toEqual([0, 1])
    expect(parts.rows.map(row => row.fart?.name)).toEqual(['Recording 1', 'Recording 2'])
    expect(parts.rows[0].fart?.recordedAt).toBe(Date.UTC(2026, 9, 21))
    expect(parts.rows.map(row => row.fart?.levels.length)).toEqual([16, 16])

    const data = JSON.stringify(parts)
    for (const secret of [R1, R2, T1]) expect(data).not.toContain(secret)
  })

  it('keeps the row of a deleted Recording, with no audio', async () => {
    const alice = await songToot()
    expect((await api.delete('recordings', R2, alice)).status).toBe(204)
    const { rows } = await partsOf(alice.url)
    expect(rows[0].fart?.name).toBe('Recording 1')
    expect(rows[1]).toMatchObject({ pitch: 64, fart: null })
    expect((await share.fart(alice.url, 0)).status).toBe(200)
    expect((await share.fart(alice.url, 1)).status).toBe(404)
  })

  it("never plays or names a Recording that isn't the Toot's owner's", async () => {
    const bob = await signUp('bob')
    const metadata = recordingMetadata(R2, { seconds: 1, sampleRate: RATE })
    expect((await api.put('recordings', R2, uploadBody(metadata, take()), bob)).status).toBe(201)
    const alice = await signUp('alice')
    await share.pick('alice', alice)
    await saveToot(T1, alice, tootWav(), tootMetadata(T1, { arrangement }))
    const url = await urlOf(await share.put(T1, alice, 'toots'))

    const { rows } = await partsOf(url)
    expect(rows.map(row => row.fart)).toEqual([null, null])
    expect((await share.fart(url, 1)).status).toBe(404)
  })

  it("stops with the Toot's link, not with the Recording's own", async () => {
    const alice = await songToot()
    const own = await share.put(R1, alice)
    expect(own.status).toBe(201)
    expect((await share.stop(R1, alice)).status).toBe(204)
    expect((await share.fart(alice.url, 0)).status).toBe(200)

    expect((await share.stop(T1, alice, 'toots')).status).toBe(204)
    expect((await share.fart(alice.url, 0)).status).toBe(404)

    const url = await urlOf(await share.put(T1, alice, 'toots'))
    expect((await share.fart(url, 0)).status).toBe(200)
    await testDb().update(shares).set({ takenDownAt: new Date() }).where(eq(shares.itemId, T1))
    expect((await share.fart(url, 0)).status).toBe(404)
  })

  it('stops when a Recording it plays is taken down', async () => {
    const alice = await songToot()
    expect((await share.put(R2, alice)).status).toBe(201)
    await testDb().update(shares).set({ takenDownAt: new Date() }).where(eq(shares.itemId, R2))
    expect((await share.fart(alice.url, 0)).status).toBe(404)
    expect((await share.fart(alice.url, 1)).status).toBe(404)
  })

  it('draws the notes the Toot saved', async () => {
    const notes = [
      { start: 0, dur: 1.5, pitch: 60 },
      { start: 1.5, dur: 6.5, pitch: 64 }
    ]
    const score = { bpm: 90, bar_lines: [0, 4], length_beats: 8, notes }
    const { url } = await songToot({ score })
    const parts = await partsOf(url)
    expect(parts.song).toEqual({ bpm: 90, length_beats: 8, notes, pitches: [60, 64] })
    expect(parts.catalogSong).toBeNull()
    expect(parts.rows.map(row => row.colorIndex)).toEqual([0, 1])
  })

  it("names its Song's notes for the page to fetch when it saved none (before #254)", async () => {
    const { url } = await songToot()
    const parts = await partsOf(url)
    expect(parts.song).toBeNull()
    expect(parts.catalogSong?.id).toBe('twinkle')
  })

  it('has no roll when its Song is gone and it saved no notes, and keeps its farts', async () => {
    const { url } = await songToot({ songId: 'no-such-song' })
    const parts = await partsOf(url)
    expect(parts.song).toBeNull()
    expect(parts.catalogSong).toBeNull()
    expect(parts.rows.map(row => row.fart?.name)).toEqual(['Recording 1', 'Recording 2'])
  })

  it("draws a Sound Pad Toot's taps, one lane per fart", async () => {
    const alice = await withFarts('alice')
    const performance = {
      recordings: [R1, R2],
      taps: [
        [0, 0],
        [0.25, 1],
        [0.5, 0]
      ]
    }
    await saveToot(T1, alice, tootWav(), padTootMetadata(T1, { performance, seconds: 1 }))
    const url = await urlOf(await share.put(T1, alice, 'toots'))

    const parts = await partsOf(url)
    expect(parts.lanes).toBe(true)
    expect(parts.song).toEqual({
      bpm: 60,
      length_beats: 1,
      notes: [
        { start: 0, dur: 0.25, pitch: 0 },
        // Cut where the Toot ends.
        { start: 0.25, dur: 0.09 - 0.01, pitch: 1 },
        { start: 0.5, dur: 0.25, pitch: 0 }
      ],
      pitches: [0, 1]
    })
    expect(parts.rows.map(({ plays, pitch }) => ({ plays, pitch }))).toEqual([
      { plays: null, pitch: 0 },
      { plays: null, pitch: 1 }
    ])
    expect(JSON.stringify(parts)).not.toContain(R1)
    expect(await framesOf(await share.fart(url, 1))).toEqual(range(FOUND_START, FOUND_END))

    // A tap of a Recording since deleted keeps its place on the roll.
    expect((await api.delete('recordings', R2, alice)).status).toBe(204)
    const after = await partsOf(url)
    expect(after.song?.notes[1]).toEqual({ start: 0.25, dur: 0.25, pitch: 1 })
    expect(after.rows[1].fart).toBeNull()
  })
})

describe('A link named for what it shares (#441)', () => {
  const urlOf = async (response: Response) => ((await response.json()) as { url: string }).url
  /** A share made before #441: its random id is its only name. */
  const fromBefore = async (kind: 'recordings' | 'toots') => {
    const [row] = await testDb().select().from(shares).where(eq(shares.kind, kind))
    await testDb().update(shares).set({ slug: null }).where(eq(shares.id, row.id))
    return row.id
  }

  it('takes the next number when the same Song is shared twice', async () => {
    const alice = await tootSharer('alice')
    await saveToot(T2, alice)
    const second = await urlOf(await share.put(T2, alice, 'toots'))
    expect(second).toBe(`${ORIGIN}/@alice/t/twinkle-twinkle-little-star-2/`)
    expect((await share.audio(alice.url)).status).toBe(200)
    expect((await share.audio(second)).status).toBe(200)
  })

  it('lets a Recording and a Toot have the same name, in their own kinds', async () => {
    const alice = await sharer('alice')
    await saveToot(T1, alice, tootWav(), tootMetadata(T1, { title: 'Recording 1', songId: 'gone' }))
    const toot = await urlOf(await share.put(T1, alice, 'toots'))
    expect(toot).toBe(`${ORIGIN}/@alice/t/recording-1/`)
    expect(alice.url).toBe(`${ORIGIN}/@alice/r/recording-1/`)
    expect((await findSharedToot(testDb(), 'alice', 'recording-1'))?.title).toBe('Recording 1')
    expect((await findSharedRecording(testDb(), 'alice', 'recording-1'))?.recording.number).toBe(1)
  })

  it('lets two people use the same name', async () => {
    const alice = await sharer('alice')
    const bob = await sharer('bob')
    expect(new URL(alice.url).pathname).toBe('/@alice/r/recording-1/')
    expect(new URL(bob.url).pathname).toBe('/@bob/r/recording-1/')
    expect((await findSharedRecording(testDb(), 'bob', 'recording-1'))?.handle).toBe('bob')
  })

  it('names a share from before it, and still finds it by its random id', async () => {
    await sharer('alice')
    const old = await fromBefore('recordings')
    expect(await findSharedRecording(testDb(), 'alice', 'recording-1')).toBeNull()

    // Found by its random id, which names it, so its page sends the old link on to the new one.
    expect((await findSharedRecording(testDb(), 'alice', old))?.slug).toBe('recording-1')
    expect((await findSharedRecording(testDb(), 'alice', 'recording-1'))?.slug).toBe('recording-1')
    expect((await findSharedRecording(testDb(), 'alice', old))?.slug).toBe('recording-1')
    expect((await share.audio(`${ORIGIN}/@alice/r/${old}/`)).status).toBe(200)
  })

  it('finds a link with its name in capitals, and its image, audio and report answer', async () => {
    const alice = await sharer('alice')
    await saveToot(T1, alice)
    expect((await share.put(T1, alice, 'toots')).status).toBe(201)
    const recording = `${ORIGIN}/@alice/r/Recording-1/`
    const toot = `${ORIGIN}/@alice/t/TWINKLE-Twinkle-Little-Star/`

    // Its own slug, not the capitals, so the page sends this link on to the lowercase one.
    expect((await findSharedRecording(testDb(), 'alice', 'Recording-1'))?.slug).toBe('recording-1')
    expect((await findSharedToot(testDb(), 'alice', 'TWINKLE-Twinkle-Little-Star'))?.slug).toBe(
      'twinkle-twinkle-little-star'
    )
    for (const url of [recording, toot]) {
      expect((await share.audio(url)).status).toBe(200)
      expect((await share.report(url)).status).toBe(204)
    }
    // A Toot's image reads the request's host, which only the journey has (e2e/share.spec.ts).
    expect((await share.image(recording)).status).toBe(200)

    // A random id from before it, in capitals too.
    const old = await fromBefore('recordings')
    expect((await findSharedRecording(testDb(), 'alice', old.toUpperCase()))?.slug).toBe(
      'recording-1'
    )
    expect((await share.audio(`${ORIGIN}/@alice/r/${old.toUpperCase()}/`)).status).toBe(200)
  })

  it('names a share from before it when its owner lists their links', async () => {
    const alice = await sharer('alice')
    await fromBefore('recordings')
    const { shares: listed } = (await (await share.list(alice)).json()) as {
      shares: { url: string }[]
    }
    expect(listed.map(({ url }) => url)).toEqual([alice.url])
  })

  it('keeps its link when the Toot is renamed', async () => {
    const alice = await tootSharer('alice')
    await testDb().update(toots).set({ title: 'For Mum' }).where(eq(toots.id, T1))
    expect(await urlOf(await share.put(T1, alice, 'toots'))).toBe(alice.url)
    expect((await findSharedToot(testDb(), 'alice', linkParts(alice.url).id))?.title).toBe(
      'For Mum'
    )
  })

  it("doesn't give a taken-down link's name to anything else", async () => {
    const alice = await tootSharer('alice')
    await testDb().update(shares).set({ takenDownAt: new Date() })
    await saveToot(T2, alice)
    const second = await urlOf(await share.put(T2, alice, 'toots'))
    expect(second).toBe(`${ORIGIN}/@alice/t/twinkle-twinkle-little-star-2/`)
    expect((await share.audio(alice.url)).status).toBe(404)
  })
})
